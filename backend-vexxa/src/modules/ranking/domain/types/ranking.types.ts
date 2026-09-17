// Shared domain types for the Ranking/Prizes module.
// No framework imports — pure TypeScript.

// ─── Calculated Winner (output of ranking aggregation) ──────────────────────

export interface CalculatedWinner {
  userId: string;
  userName: string;
  campaignId: string;
  cpaAchieved: number;
  rank: number;
  prizeType: string;
  prizeValue: number;
  prizeLabel: string;
}

// ─── My Rewards (affiliate-facing) ──────────────────────────────────────────

export interface MyReward {
  prizeId: string;
  title: string;
  prizeType: string;
  prizeValue: number;
  prizeLabel: string;
  icon: string;
  rank: number;
  cpaAchieved: number;
  redeemed: boolean;
  redeemedAt: Date | null;
  finalizedAt: Date | null;
}

// ─── Active Prize (public listing) ──────────────────────────────────────────

export interface ActivePrize {
  id: string;
  title: string;
  description: string;
  prizeType: string;
  prizeValue: number;
  prizeLabel: string;
  icon: string;
  startDate: Date;
  endDate: Date;
  winnersCount: number;
  targetCpa: number;
  bettingHouse: string | null;
  winMode: string;
  status: string;
  prizes: RankPrizeInfo[];
  createdAt: Date;
}

export interface RankPrizeInfo {
  rank: number;
  prizeType: string;
  prizeValue: number;
  prizeLabel: string;
  icon: string;
}

// ─── Prize Showcase (card com quem está ganhando / quem ganhou) ─────────────

export interface PrizeWinnerEntry {
  rank: number;
  userId: string;
  userName: string;
  cpa: number;
  prizeLabel: string;
  isMe: boolean;
}

export interface PrizeShowcase extends ActivePrize {
  /** true quando FINALIZED → `winners` são os vencedores definitivos. */
  final: boolean;
  /** true → `winners` é ranking ao vivo (quem está ganhando, RANKING em
   *  andamento); false → vencedores reais persistidos em PrizeWinner
   *  (FINALIZED, ou TARGET = quem bateu a meta). */
  liveStandings: boolean;
  /** true = meta contabilizada pela CPA da rede/downline (não a individual). */
  cpaFromNetwork: boolean;
  winners: PrizeWinnerEntry[];
}

// ─── Ranking Candidate (raw aggregation result) ─────────────────────────────

export interface RankingCandidate {
  campaignId: string;
  userId: string;
  userName: string;
  cpaQualified: number;
}

// ─── Leaderboard Entry (public affiliate ranking) ───────────────────────────

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  userName: string;
  cpa: number;
  ftd: number;
  isMe: boolean;
}

export interface LeaderboardContext {
  prizeId: string;
  title: string;
  description: string;
  icon: string;
  prizeLabel: string;
  targetCpa: number;
  winnersCount: number;
  bettingHouse: string | null;
  startDate: Date;
  endDate: Date;
  status: string;
}
