export type DatabaseStorage = {
  measuredAt: string;
  totalBytes: number;
  logicalDataDirectory: string | null;
  physicalDataDirectory: string | null;
  location: 'embedded' | 'external' | 'unavailable';
  parts: { id: 'players' | 'utility' | 'chickens' | 'other'; bytes: number }[];
};
