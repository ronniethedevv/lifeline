import { notFound } from "next/navigation";
import { getAddress, isAddress } from "viem";
import { VaultDetail } from "@/components/vault/VaultDetail";

export default function VaultDetailPage({ params }: { params: { address: string } }) {
  if (!isAddress(params.address)) notFound();
  return <VaultDetail address={getAddress(params.address)} />;
}
