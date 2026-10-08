# Circular font files

Circular (Lineto) is a commercial typeface, so it is not bundled. Drop your licensed
web-font files here with exactly these names (woff2 preferred):

- CircularXX-Book.woff2    (400)
- CircularXX-Medium.woff2  (500)
- CircularXX-Bold.woff2    (600-700)
- CircularXX-Black.woff2   (800-900)

Until they exist, the site uses Figtree (bundled via @fontsource-variable/figtree), a similar geometric sans.

The font rules are added automatically at dev/build time for whichever of these files exist (restart the dev server after adding them).
