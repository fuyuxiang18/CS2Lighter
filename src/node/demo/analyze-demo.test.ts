import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { DemoSource } from 'csdm/common/types/counter-strike';

const mocks = vi.hoisted(() => ({ run: vi.fn(), assertExists: vi.fn() }));
vi.mock('csdm/node/demo-analyzer/run-demo-analyzer', () => ({ runDemoAnalyzer: mocks.run }));
vi.mock('csdm/node/counter-strike/launcher/assert-demo-exists', () => ({ assertDemoExists: mocks.assertExists }));
vi.stubGlobal('logger', { log: vi.fn(), error: vi.fn() });

const { analyzeDemo } = await import('./analyze-demo');

beforeEach(() => vi.clearAllMocks());

describe('analyzeDemo source selection', () => {
  it('lets the analyzer detect unknown sources instead of passing an unsupported source name', async () => {
    await analyzeDemo({
      demoPath: '/demos/new-platform.dem',
      outputFolderPath: '/output',
      source: DemoSource.Unknown,
      analyzePositions: true,
    });
    expect(mocks.run).toHaveBeenCalledWith(expect.objectContaining({ source: undefined }));
  });

  it('preserves an explicitly detected platform', async () => {
    await analyzeDemo({
      demoPath: '/demos/perfectworld.dem',
      outputFolderPath: '/output',
      source: DemoSource.PerfectWorld,
      analyzePositions: true,
    });
    expect(mocks.run).toHaveBeenCalledWith(expect.objectContaining({ source: DemoSource.PerfectWorld }));
  });
});
