SHDWYI Gallery — music folder
==============================

Current playlist files (defined in the MUSIC config in
gallery-demo_v6.html — search for "const MUSIC"):

  moonlight-sonata.mp3   Moonlight Sonata — Beethoven  (ALWAYS PLAYS FIRST)
  night-dancer.mp3       Night Dancer — imase
  interstellar.mp3       Interstellar — Hans Zimmer
  still-with-you.mp3     Still With You

How it works:
  - The first playlist entry plays on every page load.
  - N key (or a track ending) advances to the next song, looping around.
  - M key / the vinyl disc in the nav toggles sound.
  - A small toast shows the song title on every change.

To add/remove/reorder songs: drop the mp3 here with a simple filename
(lowercase, hyphens, no spaces or special characters), then edit the
MUSIC.playlist array — each entry is { title, url }.

Volume, fade-in, ducking depth and skip-fade times are all knobs in
the same MUSIC config object.
