/** Decoded animation instructions; this never certifies final body hitboxes. */
export type DeathAnimationEvidence = {
  framesWithRecipe: number;
  decodedTopologyFrames: number;
  taskTypes: string[];
  graphResourceCount: number;
  boneCount: number;
  maskCount: number;
  blockingTasks: string[];
  reasons: string[];
};
