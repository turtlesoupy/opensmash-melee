let context: AudioContext | undefined;
let ready: Promise<AudioContext> | undefined;
export function unlockAudio() {
  context ??= new AudioContext({sampleRate:48000,latencyHint:'interactive'});
  void context.resume();
  ready ??= context.audioWorklet.addModule('/engine/audio-worklet.js').then(()=>context!);
  return ready;
}
export async function connectAudio(ring:SharedArrayBuffer) {
  const audio = await unlockAudio();
  const node = new AudioWorkletNode(audio,'melee-audio',{outputChannelCount:[2],processorOptions:{ring}});
  node.connect(audio.destination);
  return node;
}
