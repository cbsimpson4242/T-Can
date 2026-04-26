type FrameDriver = {
  requestAnimationFrame(callback: FrameRequestCallback): number
  cancelAnimationFrame(handle: number): void
}

const defaultFrameDriver: FrameDriver = {
  requestAnimationFrame: (callback) => window.requestAnimationFrame(callback),
  cancelAnimationFrame: (handle) => window.cancelAnimationFrame(handle),
}

export interface AnimationFrameThrottle<TArgs> {
  (args: TArgs): void
  flush(): void
  cancel(): void
}

export function createAnimationFrameThrottle<TArgs>(
  listener: (args: TArgs) => void,
  frameDriver: FrameDriver = defaultFrameDriver,
): AnimationFrameThrottle<TArgs> {
  let frameHandle: number | null = null
  let latestArgs: TArgs | null = null

  const flush = () => {
    if (latestArgs === null) {
      return
    }

    const args = latestArgs
    latestArgs = null
    listener(args)
  }

  const throttled = ((args: TArgs) => {
    latestArgs = args
    if (frameHandle !== null) {
      return
    }

    frameHandle = frameDriver.requestAnimationFrame(() => {
      frameHandle = null
      flush()
    })
  }) as AnimationFrameThrottle<TArgs>

  throttled.flush = () => {
    if (frameHandle !== null) {
      frameDriver.cancelAnimationFrame(frameHandle)
      frameHandle = null
    }

    flush()
  }

  throttled.cancel = () => {
    latestArgs = null
    if (frameHandle === null) {
      return
    }

    frameDriver.cancelAnimationFrame(frameHandle)
    frameHandle = null
  }

  return throttled
}
