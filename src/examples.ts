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
  { title: 'Warm-up', abc: TEMPLATE_ABC },
  { title: 'C Major Scale', abc: SCALE_ABC },
  { title: 'I–IV–V–I Progression', abc: CHORDS_ABC },
]
