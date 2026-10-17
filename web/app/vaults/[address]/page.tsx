import { notFound } from "next/navigation";
import { getAddress, isAddress } from "viem";
import { AppContainer } from "@/components/AppContainer";
import { VaultDetail } from "@/components/vault/VaultDetail";

export default function VaultDetailPage({ params }: { params: { address: string } }) {
  if (!isAddress(params.address)) notFound();
  return (
    <AppContainer>
      <VaultDetail address={getAddress(params.address)} />
    </AppContainer>
  );
}
