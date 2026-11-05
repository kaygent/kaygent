import { useStdout } from 'ink';
import { useEffect, useState } from 'react';

export interface Viewport {
  columns: number;
  rows: number;
}

function readProcessViewport(): Viewport {
  return {
    columns: process.stdout.columns || 100,
    rows: process.stdout.rows || 30,
  };
}

export function useTerminalSize(override?: Viewport): Viewport {
  const { stdout } = useStdout();
  const [size, setSize] = useState<Viewport>(() => override ?? readProcessViewport());
  const hasOverride = override !== undefined;

  useEffect(() => {
    if (hasOverride) {
      return;
    }

    const stream = stdout ?? process.stdout;

    const handleResize = () => {
      setSize({
        columns: stream.columns || 100,
        rows: stream.rows || 30,
      });
    };

    handleResize();
    stream.on?.('resize', handleResize);

    return () => {
      stream.off?.('resize', handleResize);
    };
  }, [stdout, hasOverride]);

  return override ?? size;
}
