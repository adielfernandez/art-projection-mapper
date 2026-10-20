import type { AnimationConfig, CaptionConfig } from '../../state/schema';
import { colorRow, h, section, sliderRow, withHelp, type SliderOpts } from '../controls';
import type { PanelContext } from './context';

type Range = Omit<SliderOpts, 'get' | 'set'>;

const ANIMATION_HELP: Record<keyof AnimationConfig, string> = {
  cycleDuration:
    'How long each artwork holds, fully visible, between its transitions. Also the cutoff for videos shorter than this (they loop until it elapses).',
  transitionInDuration: 'Length of the noise dissolve from black when a new artwork appears. Pan and zoom already move during it.',
  transitionOutDuration: 'Length of the fade to black before a frame changes artwork. Pan and zoom keep moving until it ends.',
  transitionDelay: 'How long a frame stays black after one artwork fades out, before the next one dissolves in.',
  dissolveSoftness:
    'Edge softness of the noise dissolve-in. Low = crisp, hard-edged blotches; high = wide, gradual edges that read more like a fade.',
  dissolveNoiseScale:
    'Size of the dissolve blotches. 1 = about five across a frame; 2 = twice as large. Applies live.',
  frameStagger: "Delay between frames' first cycles at startup (frame n starts n × this), so frames never change in unison.",
  maxHoldDuration:
    'Longest a panning image may hold. Wide panoramas speed up to finish within it. Does not apply to video.',
  zoomStart:
    'Starting scale for Zoom images. They move from this down to 1.0 (exact cover) from the start of the dissolve-in to the end of the fade-out. 1.15 = 15% closer.',
  panSpeed:
    'Sets how long a pan holds (travel ÷ speed), up to Max hold. The pan spans the whole visible time including both transitions, so it moves slightly slower than this.',
  panAspectThreshold:
    "How far an image's shape must differ from the frame before Pan applies. 1.15 = 15% wider or taller. Below it, the image zooms (if Zoom is on) or holds still.",
};

const CAPTION_HELP: Record<keyof CaptionConfig, string> = {
  titleSize: "Title text height, as a fraction of the frame's bottom-edge width.",
  lineTwoSize: 'Height of the "artist, year" line, as a fraction of frame width.',
  lineGap: 'Space between the title and the "artist, year" line, in frame widths.',
  riseDistance: 'How far captions drift toward the frame while fading in, in frame widths.',
  fadeDuration: "Length of the caption fade-in, which starts when the artwork's in-transition ends.",
  lineTwoDelay: 'How long the "artist, year" line waits after the title starts fading in.',
  color: 'Color of both caption lines.',
};

export function animationSection(ctx: PanelContext): HTMLElement {
  const { store, binder } = ctx;

  const anim = (key: keyof AnimationConfig, label: string, r: Range) =>
    withHelp(
      sliderRow(binder, label, {
        ...r,
        get: () => store.config.animation[key],
        set: (v) => store.setAnimation({ [key]: v }),
      }),
      ANIMATION_HELP[key],
    );
  const cap = (key: Exclude<keyof CaptionConfig, 'color'>, label: string, r: Range) =>
    withHelp(
      sliderRow(binder, label, {
        ...r,
        get: () => store.config.captions[key],
        set: (v) => store.setCaptions({ [key]: v }),
      }),
      CAPTION_HELP[key],
    );

  const sec = { min: 0, step: 0.1, decimals: 2 };
  const fw = { step: 0.001, decimals: 4 };

  return section(ctx.openState, 'animation', 'Animation', [
    h('div', { class: 'subhead', text: 'Timing (seconds)' }),
    anim('cycleDuration', 'Cycle duration', { ...sec, min: 0.5, sliderMin: 1, sliderMax: 60 }),
    anim('transitionInDuration', 'Transition in', { ...sec, sliderMin: 0, sliderMax: 10 }),
    anim('transitionOutDuration', 'Transition out', { ...sec, sliderMin: 0, sliderMax: 10 }),
    anim('transitionDelay', 'Transition delay', { ...sec, sliderMin: 0, sliderMax: 5 }),
    anim('frameStagger', 'Frame stagger', { ...sec, sliderMin: 0, sliderMax: 30 }),
    anim('maxHoldDuration', 'Max hold (pan)', { ...sec, min: 0.5, sliderMin: 1, sliderMax: 120 }),
    h('div', { class: 'subhead', text: 'Dissolve' }),
    anim('dissolveSoftness', 'Dissolve softness', { min: 0.01, step: 0.01, decimals: 2, sliderMin: 0.01, sliderMax: 4 }),
    anim('dissolveNoiseScale', 'Transition noise scale', { min: 0.05, step: 0.05, decimals: 2, sliderMin: 0.25, sliderMax: 8 }),
    h('div', { class: 'subhead', text: 'Motion' }),
    anim('zoomStart', 'Zoom start', { min: 1, step: 0.01, decimals: 3, sliderMin: 1, sliderMax: 2 }),
    anim('panSpeed', 'Pan speed (fw/s)', { min: 0.001, step: 0.001, decimals: 4, sliderMin: 0.001, sliderMax: 0.2 }),
    anim('panAspectThreshold', 'Pan aspect threshold', { min: 1, step: 0.01, decimals: 3, sliderMin: 1, sliderMax: 3 }),
    h('div', { class: 'subhead', text: 'Captions (sizes in frame widths)' }),
    cap('titleSize', 'Title size', { ...fw, min: 0.001, sliderMin: 0.005, sliderMax: 0.15 }),
    cap('lineTwoSize', 'Line 2 size', { ...fw, min: 0.001, sliderMin: 0.005, sliderMax: 0.15 }),
    cap('lineGap', 'Line gap', { ...fw, min: 0, sliderMin: 0, sliderMax: 0.1 }),
    cap('riseDistance', 'Rise distance', { ...fw, sliderMin: 0, sliderMax: 0.1 }),
    cap('fadeDuration', 'Fade duration (s)', { ...sec, sliderMin: 0, sliderMax: 5 }),
    cap('lineTwoDelay', 'Line 2 delay (s)', { ...sec, sliderMin: 0, sliderMax: 5 }),
    withHelp(
      colorRow(binder, 'Caption color', () => store.config.captions.color, (v) => store.setCaptions({ color: v })),
      CAPTION_HELP.color,
    ),
    h('div', { class: 'subhead', text: 'Effects' }),
    h('div', { class: 'muted', text: 'Effect layers and their parameters arrive in M5.' }),
  ]);
}
