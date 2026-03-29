import { listPricingSettingsAction } from "./actions";
import { PricingSettingsTable } from "./pricing-settings-table";

export default async function PricingSettingsPage() {
  const result = await listPricingSettingsAction();

  return (
    <PricingSettingsTable items={result.items} history={result.history} error={result.error} />
  );
}
