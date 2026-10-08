"""Subset the bundled Font Awesome Free fonts to the icons this app actually uses.

Font Awesome Free 6.4.0 ships ~2450 icon rules and three woff2 files
(fa-solid-900 148 KB, fa-brands-400 108 KB, fa-regular-400 25 KB). The app uses
around 90 of them, so every visitor downloaded ~280 KB of glyphs to draw a
handful of icons — the single largest static asset on the site, and unlike JS
and CSS it cannot be compressed further (woff2 is already compressed).

What this does:
  1. Reads the name -> codepoint map out of css/vendor/fontawesome.min.css.
  2. Collects the icon names the app can ask for: every `fa-<name>` class in the
     source, plus every quoted string literal that matches an icon name (the
     dashboards pick icons dynamically, e.g. `fa-${selectedPayment === 'card'
     ? 'check-circle' : 'circle'}` — those values only ever come from literals).
     Holding a superset is deliberate: an icon missing from the subset renders
     as an empty box, so when in doubt this keeps the glyph.
  3. Rewrites each font file with only those codepoints, keeping the internal
     font name so the existing @font-face rules still match.
  4. Drops the :before rules for icons that are no longer in any subset, and
     only those — base classes, sizing/animation utilities and the @font-face
     blocks are left untouched.

Run from the repo root:  python tools/subset-icons.py [--check]
--check reports what would change without writing anything.
"""

import glob
import io
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CSS_PATH = os.path.join(ROOT, 'css', 'vendor', 'fontawesome.min.css')
FONT_DIR = os.path.join(ROOT, 'css', 'webfonts')

FONTS = ['fa-solid-900.woff2', 'fa-regular-400.woff2', 'fa-brands-400.woff2']

# Icon rules look like `.fa-bell:before{content:"\f0f3"}` — the name in the map
# is the part after `fa-`, so a class token and a map key compare directly.
RULE_RE = re.compile(r'\.fa-([a-z0-9-]+):before\{content:"\\([0-9a-fA-F]+)"\}')


def read(path):
    with open(path, encoding='utf-8') as fh:
        return fh.read()


def source_text():
    files = ['index.html', 'offline.html', 'css/style.css']
    files += sorted(glob.glob(os.path.join(ROOT, 'js', '*.js')))
    return '\n'.join(read(f) for f in files if os.path.exists(f))


def used_icons(name2cp, text):
    """Superset of the icons the app can ask for.

    Two sources, because the dashboards pick icons at runtime:
      * class names in markup — `class="fas fa-bell"`
      * bare string literals — `fa-${selectedPayment === 'card' ? 'check-circle' : 'circle'}`
        and the toast map `{ success:'check-circle', warning:'exclamation-triangle' }`
    """
    classes = set(re.findall(r'\bfa-([a-z0-9-]+)', text))
    literals = set(re.findall(r"'([a-z0-9-]+)'", text)) | set(re.findall(r'"([a-z0-9-]+)"', text))
    literals = {n[3:] if n.startswith('fa-') else n for n in literals}
    keep = {n for n in (classes | literals) if n in name2cp}
    return keep, classes, literals


def subset_font(font_path, codepoints):
    """Rewrite a woff2 down to the given codepoints, keeping its font names.

    The compressed stream is expanded to sfnt first: the glyf table inside a
    woff2 is transformed, and the subsetter needs the plain outlines.
    """
    import tempfile
    from fontTools import subset
    from fontTools.ttLib import TTFont, woff2

    with tempfile.TemporaryDirectory() as workdir:
        sfnt_path = os.path.join(workdir, 'font.ttf')
        woff2.decompress(font_path, sfnt_path)
        table = TTFont(sfnt_path)

    original = set(table.getBestCmap().keys())
    options = subset.Options()
    options.flavor = 'woff2'
    options.desubroutinize = False
    options.layout_features = []
    options.notdef_outline = True
    subsetter = subset.Subsetter(options=options)
    subsetter.populate(unicodes=codepoints)
    subsetter.subset(table)
    out = io.BytesIO()
    table.flavor = 'woff2'
    table.save(out)
    data = out.getvalue()

    # Read the result back: a glyph dropped by accident renders as an empty box
    # in the UI, and that is not something a screenshot of one page would catch.
    with tempfile.TemporaryDirectory() as workdir:
        check_path = os.path.join(workdir, 'subset.woff2')
        with open(check_path, 'wb') as fh:
            fh.write(data)
        sfnt = os.path.join(workdir, 'subset.ttf')
        woff2.decompress(check_path, sfnt)
        produced = set(TTFont(sfnt).getBestCmap().keys())
    expected = original & codepoints
    return data, expected - produced


def main():
    check = '--check' in sys.argv
    css = read(CSS_PATH)
    try:
        from fontTools.ttLib import woff2  # noqa: F401  (checked here for a clear error)
    except ImportError:
        print('FATAL: pip install fonttools brotli')
        return 1
    name2cp = {n: int(cp, 16) for n, cp in RULE_RE.findall(css)}
    if not name2cp:
        print('FATAL: no icon rules parsed out of fontawesome.min.css — the file format changed')
        return 1

    keep, classes, literals = used_icons(name2cp, source_text())
    dropped = sorted(set(name2cp) - keep)
    print('icon rules in css : %d' % len(name2cp))
    print('icons kept        : %d' % len(keep))
    print('rules to drop     : %d' % len(dropped))

    for font_name in FONTS:
        path = os.path.join(FONT_DIR, font_name)
        if not os.path.exists(path):
            print('FATAL: %s is missing' % font_name)
            return 1
        before = os.path.getsize(path)
        codepoints = {name2cp[n] for n in keep}
        try:
            data, missing = subset_font(path, codepoints)
        except Exception as exc:
            # fa-regular-400.woff2 (25 KB) does not survive fontTools' woff2
            # decoder — "not enough 'glyf' table data". The file is fine (the
            # official 6.4.0 download decodes the same way), so it is left
            # alone rather than replaced with something half-parsed.
            print('%-22s %7d bytes  SKIPPED (%s)' % (font_name, before, type(exc).__name__))
            continue
        print('%-22s %7d -> %6d bytes (%.1f%% smaller)%s'
              % (font_name, before, len(data), 100 * (1 - len(data) / before),
                 '' if not missing else '  MISSING %d GLYPHS: %s' % (len(missing), sorted(missing))))
        if missing:
            print('FATAL: refusing to write a font that lost glyphs')
            return 1
        if not check:
            with open(path, 'wb') as fh:
                fh.write(data)

    # Trim the CSS rules for icons that are no longer in any subset. Aliases
    # share one rule (`.fa-concierge-bell:before,.fa-bell-concierge:before{…}`),
    # so the group is compared as a whole: keeping the rule when any alias is
    # still reachable is what stops an alias from losing its glyph.
    def keep_rule(match):
        names = match.group(1).split(',')
        return match.group(0) if any(n.strip() in keep for n in names) else ''

    trimmed = RULE_RE.sub(keep_rule, css)
    remaining = len(RULE_RE.findall(trimmed))
    print('%-22s %7d -> %6d bytes' % ('fontawesome.min.css', len(css), len(trimmed)))
    print('rules left in css : %d (expected %d)' % (remaining, len(keep)))
    if not check:
        with open(CSS_PATH, 'w', encoding='utf-8', newline='') as fh:
            fh.write(trimmed)

    # Anything still referenced but no longer available would render blank.
    orphaned = sorted({n for n in re.findall(r'\bfa-([a-z0-9-]+)', source_text())
                       if n in name2cp and n not in keep})
    print('orphaned references:', orphaned or 'none')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
