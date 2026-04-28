function assertFinitePositive(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a finite positive number.`);
  }
  return value;
}

function assertChannelCount(channelCount: number): number {
  if (!Number.isInteger(channelCount) || channelCount <= 0) {
    throw new Error("channelCount must be a positive integer.");
  }
  return channelCount;
}

export function resampleInterleavedFloat32(
  inputBuffer: Float32Array,
  sourceSampleRate: number,
  targetSampleRate: number,
  channelCount: number
): Float32Array {
  const safeSourceSampleRate = assertFinitePositive(sourceSampleRate, "sourceSampleRate");
  const safeTargetSampleRate = assertFinitePositive(targetSampleRate, "targetSampleRate");
  const safeChannelCount = assertChannelCount(channelCount);

  if (inputBuffer.length === 0) {
    return new Float32Array(0);
  }
  if (inputBuffer.length % safeChannelCount !== 0) {
    throw new Error("inputBuffer length must be divisible by channelCount.");
  }

  const sourceFrames = inputBuffer.length / safeChannelCount;
  const targetIntervalFrames = Math.max(
    1,
    Math.round((sourceFrames * safeTargetSampleRate) / safeSourceSampleRate)
  );
  const outputBuffer = new Float32Array(targetIntervalFrames * safeChannelCount);

  if (sourceFrames === 1) {
    for (let frameIndex = 0; frameIndex < targetIntervalFrames; frameIndex += 1) {
      for (let channelIndex = 0; channelIndex < safeChannelCount; channelIndex += 1) {
        outputBuffer[frameIndex * safeChannelCount + channelIndex] = inputBuffer[channelIndex] ?? 0;
      }
    }
    return outputBuffer;
  }

  const sourceFramesPerTargetFrame = safeSourceSampleRate / safeTargetSampleRate;
  for (let targetFrameIndex = 0; targetFrameIndex < targetIntervalFrames; targetFrameIndex += 1) {
    const sourcePosition = targetFrameIndex * sourceFramesPerTargetFrame;
    const leftFrameIndex = Math.min(sourceFrames - 1, Math.floor(sourcePosition));
    const rightFrameIndex = Math.min(sourceFrames - 1, leftFrameIndex + 1);
    const mix = sourcePosition - leftFrameIndex;

    for (let channelIndex = 0; channelIndex < safeChannelCount; channelIndex += 1) {
      const leftSample = inputBuffer[leftFrameIndex * safeChannelCount + channelIndex] ?? 0;
      const rightSample = inputBuffer[rightFrameIndex * safeChannelCount + channelIndex] ?? leftSample;
      outputBuffer[targetFrameIndex * safeChannelCount + channelIndex] =
        leftSample + (rightSample - leftSample) * mix;
    }
  }

  return outputBuffer;
}
