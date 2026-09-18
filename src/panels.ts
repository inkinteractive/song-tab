/**
 * Panels that are built and working but not on screen.
 *
 * These were hidden to get the page down to the three things a lesson uses -
 * the transport, the tab and the chord chart - rather than deleted, because
 * every one of them has been wanted at some point. Flip a flag to bring one
 * back; nothing else needs changing.
 *
 * What each one takes with it when it is off:
 *
 *   ENGINE_SETTINGS   chord vocabulary, stickiness, beats per bar, the two
 *                     pitch ranges, note confidence, riff quantisation, and
 *                     the tempo and key overrides. Analysis runs on
 *                     DEFAULT_SETTINGS.
 *   WHAT_IT_HEARD     the only editor for tempo, key, time signature, tuning,
 *                     capo, transpose and strum pattern, plus the Re-trim and
 *                     Re-analyse buttons. Re-trimming and re-analysing are
 *                     still reachable from the stepper in the header; the
 *                     arrangement fields are not reachable anywhere else.
 *   RIFF_EDITOR       per-note editing: pitch, length, octave shift, delete.
 *   RELIABILITY_NOTE  the banner over the tab that says when the progression
 *                     never settles into a key. This covers both of its
 *                     wordings: the amber "check these chords" and the red
 *                     "these chords are probably wrong". The chart still gets
 *                     scored (`analysis/reliability.ts`), nothing says so.
 *
 * Typed as `boolean` rather than left as literals so a flag that is off does
 * not make TypeScript treat the branch as dead code.
 */

export const SHOW_ENGINE_SETTINGS: boolean = false;
export const SHOW_WHAT_IT_HEARD: boolean = false;
export const SHOW_RIFF_EDITOR: boolean = false;
export const SHOW_RELIABILITY_NOTE: boolean = false;
