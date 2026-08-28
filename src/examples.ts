export const TUTORIAL_ABC = `X:1
T:Start Here — Learn to Type Music
M:4/4
L:1/4
Q:1/4=100
%%score { 1 | 2 }
K:C
V:1 clef=treble
V:2 clef=bass
% Welcome! Lines starting with one % sign are notes-to-self — the score ignores them.
% The two lines at the very bottom are the actual music:
%   [V:1] is the RIGHT hand (treble), [V:2] is the LEFT hand (bass).
%
% THE BASICS
%   Notes are letters:  C D E F G A B   (the octave starting at middle C)
%   Lowercase = an octave higher: c     A comma = an octave lower: C,
%   Numbers stretch notes: C2 = half note, C4 = whole note
%   | is a barline.  [CEG] = a chord (notes together).  z = a rest.
%
% TRY IT — watch the score on the right as you type:
%   1. In the [V:1] line below, change the first C to an E
%   2. Add  | c d e f  just before the |] at the end of that line
%   3. Press Ctrl+Enter (or the Play button) to hear both hands
%   4. Click "? Help" (top right) any time for the full cheat sheet
[V:1] C D E F | G2 [ceg]2 | c4 |]
[V:2] C,2 G,2 | C,2 G,2 | C,4 |]
`

export const TEMPLATE_ABC = `X:1
T:Warm-up
M:4/4
L:1/4
Q:1/4=100
%%score { 1 | 2 }
K:C
V:1 clef=treble
V:2 clef=bass
[V:1] C D E F | G2 [ceg]2 | c4 |]
[V:2] C,2 G,2 | C,2 G,2 | C,4 |]
`

export const SCALE_ABC = `X:1
T:C Major Scale — Hands Together
M:4/4
L:1/4
Q:1/4=90
%%score { 1 | 2 }
K:C
V:1 clef=treble
V:2 clef=bass
[V:1] C D E F | G A B c | c B A G | F E D C |]
[V:2] C, D, E, F, | G, A, B, C | C B, A, G, | F, E, D, C, |]
`

export const CHORDS_ABC = `X:1
T:I–IV–V–I Progression
M:4/4
L:1/4
Q:1/4=80
%%score { 1 | 2 }
K:C
V:1 clef=treble
V:2 clef=bass
[V:1] [CEG]4 | [CFA]4 | [B,DG]4 | [CEG]4 |]
[V:2] C,2 E,2 | F,2 A,2 | G,2 B,2 | C,4 |]
`

export const SEED_DOCS = [
  { title: 'Start Here', abc: TUTORIAL_ABC },
  { title: 'Warm-up', abc: TEMPLATE_ABC },
  { title: 'C Major Scale', abc: SCALE_ABC },
  { title: 'I–IV–V–I Progression', abc: CHORDS_ABC },
]
