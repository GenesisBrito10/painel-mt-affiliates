// ─── Leaderboard ──────────────────────────────────────────────────────────────

export interface LeaderboardEntry {
  rank: number
  userId: string
  userName: string
  cpa: number
  ftd: number
  isMe: boolean
}

export interface LeaderboardContext {
  prizeId: string
  title: string
  description: string
  icon: string
  prizeLabel: string
  targetCpa: number
  winnersCount: number
  bettingHouse: string | null
  startDate: string
  endDate: string
  status: string
}

export interface LeaderboardResponse {
  data: LeaderboardEntry[]
  context: LeaderboardContext | null
}

// ─── Active Prize ─────────────────────────────────────────────────────────────

export interface RankPrizeInfo {
  rank: number
  prizeType: string
  prizeValue: number
  prizeLabel: string
  icon: string
}

export interface ActivePrize {
  id: string
  title: string
  description: string
  prizeType: string
  prizeValue: number
  prizeLabel: string
  icon: string
  startDate: string
  endDate: string
  winnersCount: number
  targetCpa: number
  bettingHouse: string | null
  winMode: 'RANKING' | 'TARGET'
  status: string
  prizes: RankPrizeInfo[]
  createdAt: string
}

export interface ActivePrizesResponse {
  data: ActivePrize[]
}

// ─── Prize Showcase (card com quem está ganhando / quem ganhou) ─────────────

export interface PrizeWinnerEntry {
  rank: number
  userId: string
  userName: string
  cpa: number
  prizeLabel: string
  isMe: boolean
}

export interface PrizeShowcase extends ActivePrize {
  /** true = FINALIZED (vencedores definitivos) */
  final: boolean
  /** true = ranking ao vivo (RANKING em andamento); false = vencedores reais
   *  persistidos (FINALIZED ou TARGET = quem bateu a meta) */
  liveStandings: boolean
  /** true = meta pela CPA da rede/downline */
  cpaFromNetwork: boolean
  winners: PrizeWinnerEntry[]
}

export interface PrizeShowcaseResponse {
  data: PrizeShowcase[]
}

// ─── My Rewards ───────────────────────────────────────────────────────────────

export interface MyReward {
  prizeId: string
  title: string
  prizeType: string
  prizeValue: number
  prizeLabel: string
  icon: string
  rank: number
  cpaAchieved: number
  redeemed: boolean
  redeemedAt: string | null
  finalizedAt: string | null
}

export interface MyRewardsResponse {
  data: MyReward[]
}

// ─── Redeem ───────────────────────────────────────────────────────────────────

export interface RedeemResponse {
  success: boolean
  message: string
}

export type LeaderboardPeriod = 'month' | 'week' | 'today'
