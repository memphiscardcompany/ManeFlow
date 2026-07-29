export type Market = {
  value: number | null;
  range: { low: number | null; high: number | null };
  trend30Pct: number | null;
  direction: 'rising' | 'falling' | 'steady' | 'insufficient_data';
  volume90: number;
  confidence: number;
};

export type Card = {
  id: string;
  year: number;
  brand: string;
  set: string;
  player: string;
  cardNumber: string;
  parallel: string;
  sport: string;
  grade: { company: string; grade: string };
  image: string;
  imageAlt?: string;
  imageMeta?: {
    status: string;
    source: string;
    remote: boolean;
    placeholder: boolean;
    rightsStatus: string;
    rightsNotes: string;
  };
  market?: Market;
  confidence?: number;
};
