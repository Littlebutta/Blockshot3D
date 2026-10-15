# Sounds

Drop audio files (mp3, ogg, wav or m4a) in this folder, then put each file name
next to the matching event in `sounds.json`. Example:

    "shoot": "laser_01.wav",
    "battle": "my_battle_theme.mp3"

Any event left as "" keeps its built-in synthesized placeholder, so you can replace
sounds one at a time. Refresh the browser page after editing.

| Event       | When it plays                                   |
|-------------|-------------------------------------------------|
| shoot       | any player fires (quieter when far away)        |
| hit         | a bullet or explosion damages someone           |
| hurt        | extra sound when YOU take damage                |
| block       | a bullet is stopped by a block bubble           |
| shield      | someone activates block                         |
| bounce      | a bullet ricochets                              |
| explode     | explosive bullets go off                        |
| death       | a player is knocked out                         |
| jump        | you jump                                        |
| reload      | you start reloading                             |
| roundStart  | "Round N" banner                                |
| fight       | "Fight!" banner                                 |
| roundWin    | your side won the round                         |
| roundLose   | your side lost the round                        |
| cardPick    | you picked a card                               |
| reroll      | you rerolled your card offer                    |
| ui          | menu button clicks                              |
| victory     | you won the match                               |
| defeat      | you lost the match                              |
| menu (music)     | title screen and lobby                                         |
| battle (music)   | during matches                                                 |
| boss (music)     | while the co-op final boss is alive                            |
| suspense (music) | a deciding round (match point) once only two fighters are left |

Short, punchy files (under 1 second) work best for effects.

Music entries take one file name or a list, which becomes a playlist:

    "battle": ["fight_a.mp3", "fight_b.mp3", "fight_c.mp3"]

One file loops; a list cycles, crossfading into the next file 3 seconds before the current one ends.
Every music change (next song, battle to boss, to the suspense track) is a crossfade.
Without files, the built-in tracks play: two menu songs, four battle songs that cycle every
24-32 bars, a boss theme and a suspense track.
