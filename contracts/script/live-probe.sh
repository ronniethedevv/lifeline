#!/usr/bin/env bash
# T0.5 part B + T0.6: prove on LIVE Mezo testnet that a contract (TroveOwnerProbe, compiled
# for london) can be deployed and can open, manage and close its own MUSD trove.
#
# Uses cast/forge create, not `forge script`: Forge's local simulation can't execute Mezo's
# oracle precompile, so any price-dependent call would revert in simulation.
#
# Usage (from contracts/):
#   script/live-probe.sh              # dry run: reads chain state, prints the plan, sends nothing
#   script/live-probe.sh --broadcast  # sends the 9 transactions listed in the dry run
#   script/live-probe.sh [--broadcast] --resume <probe> <step>
#                                     # continue an interrupted run from <step> (4-9) on an
#                                     # existing probe; the dry run lists the remaining txs
#
# Needs contracts/.env: MEZO_TESTNET_RPC, DEPLOYER_PRIVATE_KEY (testnet-only wallet).
set -euo pipefail

cd "$(dirname "$0")/.."
set -a
# shellcheck disable=SC1091
. ./.env
set +a

BROADCAST=false
START=1
PROBE=""
while [[ $# -gt 0 ]]; do
	case "$1" in
	--broadcast) BROADCAST=true; shift ;;
	--resume) PROBE="$2"; START="$3"; shift 3 ;;
	*) echo "unknown argument: $1" >&2; exit 2 ;;
	esac
done
[[ "$START" == 1 || ( "$START" -ge 4 && "$START" -le 9 && -n "$PROBE" ) ]] || { echo "--resume needs <probe> and a step 4-9" >&2; exit 2; }

: "${MEZO_TESTNET_RPC:?set MEZO_TESTNET_RPC in contracts/.env}"
: "${DEPLOYER_PRIVATE_KEY:?set DEPLOYER_PRIVATE_KEY in contracts/.env}"
RPC="$MEZO_TESTNET_RPC"
EXPECTED_CHAIN_ID=31611
TARGET_ICR=2000000000000000000 # 200%, 1e18
NICR_PRECISION=100000000000000000000
ADD_COLL=1000000000000000 # 0.001 BTC
BORROW=100000000000000000000 # 100 MUSD
HINT_TRIALS=15
GAS_BUFFER=5000000000000000 # 0.005 BTC reserved for gas
TOPUP_BUFFER=1000000000000000000 # 1 MUSD over the close shortfall (interest accrues per second)
TOPUP_ESTIMATE=5000000000000000000 # 5 MUSD expected for fee + interest

# --- Pinned MUSD addresses (deployments/testnet.json, T0.3) ---
addr() { python3 -I -c 'import json,sys;print(json.load(open(sys.argv[1]))["musd"][sys.argv[2]]["address"])' ../deployments/testnet.json "$1"; }
BO=$(addr BorrowerOperations)
TM=$(addr TroveManager)
PF=$(addr PriceFeed)
HH=$(addr HintHelpers)
ST=$(addr SortedTroves)
MUSD=$(addr MUSD)

# --- Helpers (never echo the key; no `set -x`) ---
# Read-only commands retry on RPC errors; sends never retry (a retry could double-send).
retry() {
	local i out
	for i in 1 2 3 4 5 6; do
		if out=$("$@" 2>/dev/null) && [[ -n "$out" ]]; then
			printf '%s\n' "$out"
			return 0
		fi
		sleep $((i * 2))
	done
	echo "STOP: read failed after retries: $1 $2 $3" >&2
	return 1
}
call() { retry cast call "$@" --rpc-url "$RPC" | awk '{print $1}'; }
bal() { retry cast balance "$1" --rpc-url "$RPC"; }
step() { [[ "$1" -ge "$START" ]]; }
send() {
	local out hash status
	out=$(cast send "$@" --rpc-url "$RPC" --private-key "$DEPLOYER_PRIVATE_KEY" --json)
	hash=$(python3 -I -c 'import json,sys;print(json.loads(sys.stdin.read())["transactionHash"])' <<<"$out")
	status=$(python3 -I -c 'import json,sys;print(json.loads(sys.stdin.read())["status"])' <<<"$out")
	[[ "$status" == "0x1" || "$status" == "1" ]] || die "tx reverted: $hash"
	echo "    tx $hash"
}
py() { python3 -I -c "$1"; }
die() { echo "STOP: $*" >&2; exit 1; }
check() { # check <label> <actual> <op> <expected>
	py "import sys; a,b=int('$2'),int('$4'); sys.exit(0 if ($3) else 1)" || die "$1: got $2, expected $3 $4"
	echo "    ok  $1"
}
fmt() { py "print(f'{int(\"$1\")/1e18:.6f}')"; }
hints() { # hints <coll> <debt> -> "upper lower"
	local nicr approx
	nicr=$(py "print(int('$1')*$NICR_PRECISION//int('$2'))")
	approx=$(retry cast call "$HH" "getApproxHint(uint256,uint256,uint256)(address,uint256,uint256)" "$nicr" "$HINT_TRIALS" 42 --rpc-url "$RPC" | head -1)
	[[ "$approx" == 0x* ]] || return 1
	retry cast call "$ST" "findInsertPosition(uint256,address,address)(address,address)" "$nicr" "$approx" "$approx" --rpc-url "$RPC" | tr '\n' ' '
}
hints_now() { # hints for the probe's current trove: coll, principal + interest
	local d
	d=$(retry cast call "$TM" "getEntireDebtAndColl(address)(uint256,uint256,uint256,uint256,uint256,uint256)" "$PROBE" --rpc-url "$RPC" | awk '{print $1}' | tr '\n' ' ')
	[[ $(wc -w <<<"$d") -eq 6 ]] || return 1
	hints "$(py "print('$d'.split()[0])")" "$(py "d='$d'.split(); print(int(d[1])+int(d[2]))")"
}

# --- Read-only preflight ---
CHAIN_ID=$(retry cast chain-id --rpc-url "$RPC")
[[ "$CHAIN_ID" == "$EXPECTED_CHAIN_ID" ]] || die "chain id $CHAIN_ID is not Mezo testnet ($EXPECTED_CHAIN_ID)"
DEPLOYER=$(cast wallet address --private-key "$DEPLOYER_PRIVATE_KEY")
BTC_BAL=$(bal "$DEPLOYER")
MUSD_BAL=$(call "$MUSD" "balanceOf(address)(uint256)" "$DEPLOYER")
PRICE=$(call "$PF" "fetchPrice()(uint256)")
MIN_DEBT=$(call "$BO" "minNetDebt()(uint256)")
FEE=$(call "$BO" "getBorrowingFee(uint256)(uint256)" "$MIN_DEBT")
GAS_COMP=$(call "$BO" "MUSD_GAS_COMPENSATION()(uint256)")
COMPOSITE=$(py "print($MIN_DEBT+$FEE+$GAS_COMP)")
COLL=$(py "print($COMPOSITE*$TARGET_ICR//$PRICE + 1)")
RECOVERY=$(retry cast call "$TM" "checkRecoveryMode(uint256)(bool)" "$PRICE" --rpc-url "$RPC")
NEED_BTC=$(py "print($COLL+$ADD_COLL+$GAS_BUFFER)")
if [[ "$START" -gt 1 ]]; then
	[[ "$(call "$PROBE" "owner()(address)")" == "$DEPLOYER" ]] || die "probe $PROBE is not owned by the deployer"
	[[ "$(call "$TM" "getTroveStatus(address)(uint8)" "$PROBE")" == 1 ]] || die "probe trove is not active"
	ONCHAIN_COLL=$(call "$TM" "getTroveColl(address)(uint256)" "$PROBE")
	# Before step 6 the trove still holds the extra 0.001 BTC from step 3.
	if [[ "$START" -le 6 ]]; then COLL=$(py "print($ONCHAIN_COLL-$ADD_COLL)"); else COLL=$ONCHAIN_COLL; fi
	NEED_BTC=$GAS_BUFFER
fi

cat <<EOF
== Lifeline live probe (T0.5 part B + T0.6) ==
Chain:     Mezo testnet ($CHAIN_ID)
Deployer:  $DEPLOYER
Balances:  $(fmt "$BTC_BAL") BTC, $(fmt "$MUSD_BAL") MUSD
Price:     $(fmt "$PRICE") MUSD/BTC   Recovery Mode: $RECOVERY
Trove:     debt $(fmt "$MIN_DEBT") + fee $(fmt "$FEE") + gas comp $(fmt "$GAS_COMP") = $(fmt "$COMPOSITE") MUSD
           collateral $(fmt "$COLL") BTC (~200% ICR)

$([[ "$START" -gt 1 ]] && echo "RESUMING probe $PROBE from step $START (earlier steps already on-chain; only steps >= $START are sent)")
Transactions to send (all from the deployer):
  1. Deploy TroveOwnerProbe (london)                       gas only
  2. probe.open(minNetDebt, hints)                         $(fmt "$COLL") BTC
  3. probe.addColl(hints)                                  $(fmt "$ADD_COLL") BTC
  4. probe.borrow(100 MUSD, hints)                         gas only
  5. probe.repay(100 MUSD, hints)                          gas only
  6. probe.withdrawColl(0.001 BTC, hints)                  gas only (BTC back to probe)
  7. MUSD.transfer(probe, close shortfall + 1 MUSD)        ~$(fmt "$TOPUP_ESTIMATE") MUSD (exact amount computed at step 7)
  8. probe.close()                                         gas only (all coll back to probe)
  9. probe.sweep()                                         gas only (all BTC + MUSD back to deployer)
Needs:     >= $(fmt "$NEED_BTC") BTC (incl. $(fmt "$GAS_BUFFER") gas reserve), >= ~$(fmt "$TOPUP_ESTIMATE") MUSD
EOF

OK=true
py "import sys; sys.exit(0 if $BTC_BAL >= $NEED_BTC else 1)" || { echo "!! Not enough BTC"; OK=false; }
py "import sys; sys.exit(0 if $MUSD_BAL >= $TOPUP_ESTIMATE else 1)" || { echo "!! Not enough MUSD"; OK=false; }
[[ "$RECOVERY" == "false" ]] || { echo "!! System is in Recovery Mode (close would revert)"; OK=false; }

if ! $BROADCAST; then
	echo
	echo "Dry run only: nothing sent. Re-run with --broadcast to send the transactions above."
	$OK || exit 1
	exit 0
fi
$OK || die "preflight failed"

if step 1; then
# --- 1. Deploy (default profile = london) ---
echo "1. deploy TroveOwnerProbe"
forge build --silent
DEPLOY_OUT=$(forge create test/fork/utils/TroveOwnerProbe.sol:TroveOwnerProbe \
	--rpc-url "$RPC" --private-key "$DEPLOYER_PRIVATE_KEY" --broadcast --json \
	--constructor-args "$BO" "$MUSD")
PROBE=$(python3 -I -c 'import json,sys;print(json.loads(sys.stdin.read())["deployedTo"])' <<<"$DEPLOY_OUT")
DEPLOY_TX=$(python3 -I -c 'import json,sys;print(json.loads(sys.stdin.read())["transactionHash"])' <<<"$DEPLOY_OUT")
echo "    tx $DEPLOY_TX"
echo "    probe $PROBE"
# Deployed runtime code must equal the local london build, ignoring immutable slots.
python3 -I - "$(retry cast code "$PROBE" --rpc-url "$RPC")" out/TroveOwnerProbe.sol/TroveOwnerProbe.json <<'PYEOF' || die "deployed bytecode differs from local london build"
import json, sys
onchain = bytes.fromhex(sys.argv[1][2:])
art = json.load(open(sys.argv[2]))["deployedBytecode"]
local = bytearray(bytes.fromhex(art["object"][2:]))
chain = bytearray(onchain)
assert len(local) == len(chain), f"length {len(local)} != {len(chain)}"
for refs in art.get("immutableReferences", {}).values():
    for r in refs:
        s, n = r["start"], r["length"]
        chain[s:s + n] = local[s:s + n]
assert local == chain, "code mismatch outside immutables"
PYEOF
echo "    ok  deployed bytecode == local london build"
fi

if step 2; then
# --- 2. Open ---
echo "2. open"
HN=$(hints "$COLL" "$COMPOSITE") || die "hint read failed"; read -r U L <<<"$HN"
send "$PROBE" "open(uint256,address,address)" "$MIN_DEBT" "$U" "$L" --value "$COLL"
check "status active" "$(call "$TM" "getTroveStatus(address)(uint8)" "$PROBE")" "a == b" 1
check "coll" "$(call "$TM" "getTroveColl(address)(uint256)" "$PROBE")" "a == b" "$COLL"
check "MUSD to probe" "$(call "$MUSD" "balanceOf(address)(uint256)" "$PROBE")" "a == b" "$MIN_DEBT"

fi

if step 3; then
# --- 3. Add collateral ---
echo "3. addColl"
HN=$(hints "$(py "print($COLL+$ADD_COLL)")" "$COMPOSITE") || die "hint read failed"; read -r U L <<<"$HN"
send "$PROBE" "addColl(address,address)" "$U" "$L" --value "$ADD_COLL"
check "coll up" "$(call "$TM" "getTroveColl(address)(uint256)" "$PROBE")" "a == b" "$(py "print($COLL+$ADD_COLL)")"

fi

DEBT1=$(call "$TM" "getTroveDebt(address)(uint256)" "$PROBE")
if step 4; then
# --- 4/5. Borrow, repay ---
echo "4. borrow"
DEBT0=$(call "$TM" "getTroveDebt(address)(uint256)" "$PROBE")
HN=$(hints_now) || die "hint read failed"; read -r U L <<<"$HN"
send "$PROBE" "borrow(uint256,address,address)" "$BORROW" "$U" "$L"
DEBT1=$(call "$TM" "getTroveDebt(address)(uint256)" "$PROBE")
check "debt up" "$DEBT1" "a > b" "$DEBT0"
fi
if step 5; then
echo "5. repay"
HN=$(hints_now) || die "hint read failed"; read -r U L <<<"$HN"
send "$PROBE" "repay(uint256,address,address)" "$BORROW" "$U" "$L"
check "debt down" "$(call "$TM" "getTroveDebt(address)(uint256)" "$PROBE")" "a < b" "$DEBT1"

fi

if step 6; then
# --- 6. Withdraw collateral ---
echo "6. withdrawColl"
BTC_P0=$(bal "$PROBE")
HN=$(hints_now) || die "hint read failed"; read -r U L <<<"$HN"
send "$PROBE" "withdrawColl(uint256,address,address)" "$ADD_COLL" "$U" "$L"
check "BTC to probe" "$(bal "$PROBE")" "a == b" "$(py "print($BTC_P0+$ADD_COLL)")"
check "coll back" "$(call "$TM" "getTroveColl(address)(uint256)" "$PROBE")" "a == b" "$COLL"

fi

if step 7; then
# --- 7. Top up MUSD for close ---
echo "7. MUSD top-up"
NEEDED=$(py "print($(call "$TM" "getTroveDebt(address)(uint256)" "$PROBE") - $GAS_COMP)")
HAVE=$(call "$MUSD" "balanceOf(address)(uint256)" "$PROBE")
TOPUP=$(py "print(max(0, $NEEDED - $HAVE) + $TOPUP_BUFFER)")
echo "    shortfall + buffer = $(fmt "$TOPUP") MUSD"
send "$MUSD" "transfer(address,uint256)" "$PROBE" "$TOPUP"

fi

if step 8; then
# --- 8. Close ---
echo "8. close"
BTC_P1=$(bal "$PROBE")
send "$PROBE" "close()"
check "status closedByOwner" "$(call "$TM" "getTroveStatus(address)(uint8)" "$PROBE")" "a == b" 2
check "all coll to probe" "$(bal "$PROBE")" "a == b" "$(py "print($BTC_P1+$COLL)")"

fi

# --- 9. Sweep ---
echo "9. sweep"
send "$PROBE" "sweep()"
check "probe BTC empty" "$(bal "$PROBE")" "a == b" 0
check "probe MUSD empty" "$(call "$MUSD" "balanceOf(address)(uint256)" "$PROBE")" "a == b" 0

echo
echo "DONE: contract-owned trove lifecycle passed on live Mezo testnet. Probe: $PROBE"
