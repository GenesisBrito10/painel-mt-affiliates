export interface CutoverHouseSnapshot {
  id: string;
  bettingHouseSlug: string;
  active: boolean;
}

export interface CutoverAccountSnapshot {
  id: string;
  name: string;
  provider: string;
  active: boolean;
  houses: CutoverHouseSnapshot[];
}

export interface SportingbetOtgCutoverPlan {
  otgAccountId: string | null;
  otgAssociationId: string | null;
  deactivateBetboardAssociationIds: string[];
  deactivateBetboardAccountIds: string[];
}

export function buildSportingbetOtgCutoverPlan(
  accounts: CutoverAccountSnapshot[],
): SportingbetOtgCutoverPlan {
  const otgAccount = accounts.find(
    (candidate) =>
      candidate.provider === 'otg' && candidate.name === 'SPORTINGBET OTG',
  );
  const otgAssociation = otgAccount?.houses.find(
    (house) => house.bettingHouseSlug === 'sportingbet',
  );

  const betboardAccounts = accounts.filter(
    (candidate) => candidate.provider === 'betboard',
  );
  const replacedAssociations = betboardAccounts.flatMap((candidate) =>
    candidate.houses.filter(
      (house) => house.bettingHouseSlug === 'sportingbet' && house.active,
    ),
  );
  const replacedAccountIds = betboardAccounts
    .filter((candidate) => {
      const replacesSportingbet = candidate.houses.some(
        (house) => house.bettingHouseSlug === 'sportingbet' && house.active,
      );
      const hasOtherActiveHouse = candidate.houses.some(
        (house) => house.bettingHouseSlug !== 'sportingbet' && house.active,
      );
      return replacesSportingbet && !hasOtherActiveHouse;
    })
    .map((candidate) => candidate.id);

  return {
    otgAccountId: otgAccount?.id ?? null,
    otgAssociationId: otgAssociation?.id ?? null,
    deactivateBetboardAssociationIds: replacedAssociations.map(
      (association) => association.id,
    ),
    deactivateBetboardAccountIds: replacedAccountIds,
  };
}
