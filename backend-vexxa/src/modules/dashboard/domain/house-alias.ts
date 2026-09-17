/**
 * Casas que herdam os dados brutos (affiliate_data) de OUTRA casa por usarem a
 * mesma conta do provedor. O saldo/métrica continua no bucket da CASA DO LINK
 * (saldos separados); só a FONTE do dado bruto é redirecionada na hora de casar
 * affiliate_data ↔ link.
 *
 * O Betano Diário possui sincronização própria e, portanto, não herda mais os
 * dados do Betano comum.
 */
export const HOUSE_DATA_SOURCE: Record<string, string> = {
  'esportiva-diario': 'esportivabet',
  'sportingbet-diario': 'sportingbet',
  // Pinbet NÃO usa alias: diário e mensal puxam da mesma conta/API Smartico, mas
  // em dimensões diferentes (group_by=afp1 vs afp2) → conjuntos disjuntos. Cada
  // casa é sua própria fonte (affiliate_data tagueado na própria casa).
};

/** Casa onde o affiliate_data da campanha do link realmente está tagueado. */
export function dataSourceHouse(linkHouse: string): string {
  return HOUSE_DATA_SOURCE[linkHouse] ?? linkHouse;
}
