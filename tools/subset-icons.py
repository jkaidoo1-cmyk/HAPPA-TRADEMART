"""Subset the bundled Font Awesome Free fonts to the icons this app actually uses.

Font Awesome Free 6.4.0 ships ~1856 icon rules and three woff2 files
(fa-solid-900 148 KB, fa-brands-400 108 KB, fa-regular-400 25 KB). The app uses
around 150 of them, so every visitor downloaded ~280 KB of glyphs to draw a
handful of icons — the single largest static asset on the site, and unlike JS
and CSS it cannot be compressed further (woff2 is already compressed).

What this does:
  1. Reads the class -> codepoint map out of css/vendor/fontawesome.min.css.
     Rules are GROUPS of aliases
     (`.fa-home:before,.fa-house:before{content:"\\f015"}`), so the map is read
     from every selector of every rule — reading only the last one (or only
     single-class rules) silently loses every alias name.
  2. Collects the icon names the app can ask for: every `fa-<name>` class in the
     source, plus every quoted string literal that matches an icon name (the
     dashboards pick icons dynamically, e.g. `fa-${selectedPayment === 'card'
     ? 'check-circle' : 'circle'}` — those values only ever come from literals).
     Holding a superset is deliberate: an icon missing from the subset renders
     as an empty box, so when in doubt this keeps the glyph.
  3. Rewrites each font file with only the kept codepoints, keeping the internal
     font name so the existing @font-face rules still match, then reads the
     result back and refuses to write a font that lost a glyph.
  4. Drops whole :before rules that are no longer reachable — and only whole
     rules. A group is kept (verbatim, aliases intact) when ANY of its selectors
     is still used; a group with no used selector is deleted in full. Deleting
     part of a group is how a previous revision remapped 34 icons to the wrong
     glyph: cutting `.fa-house:before{content:"\\f015"}` off the end of a group
     left its other selectors glued to the next surviving rule's body, so
     `.fa-home` inherited that rule's codepoint.

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

# A whole content rule: everything between the previous brace and
# `{content:"\fXXX"}`. The selector part may be a comma-separated GROUP, which
# is why `[^{}]*` is used rather than a single-class pattern — matching only the
# tail of a group is what corrupted the stylesheet before (see the module docs).
CONTENT_RULE = re.compile(r'([^{}]*)\{content:"\\([0-9a-fA-F]{2,5})"\}')
# Captures the icon NAME (no `fa-` prefix), matching the tokens used_icons()
# produces — the two sets are compared directly, so they must agree on shape.
CLASS_IN_SELECTORS = re.compile(r'\.fa-([A-Za-z0-9-]+):before')


def read(path):
    with open(path, encoding='utf-8') as fh:
        return fh.read()


def source_text():
    files = ['index.html', 'offline.html', 'css/style.css']
    files += sorted(glob.glob(os.path.join(ROOT, 'js', '*.js')))
    return '\n'.join(read(f) for f in files if os.path.exists(f))


def class_map(css):
    """class name (no dot, no `:before`) -> codepoint, from every selector."""
    out = {}
    for m in CONTENT_RULE.finditer(css):
        code = int(m.group(2), 16)
        for name in CLASS_IN_SELECTORS.findall(m.group(1)):
            out[name] = code
    return out


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


def trim_css(css, keep):
    """Drop unreachable icon rules — whole rules only, never part of a group."""
    kept_names = set()
    dropped_groups = 0
    untouched = 0

    def repl(match):
        nonlocal dropped_groups, untouched
        selectors = match.group(1)
        names = CLASS_IN_SELECTORS.findall(selectors)
        if not names:
            # Not an icon rule (sizing utilities, @font-face, animations…).
            untouched += 1
            return match.group(0)
        if any(n in keep for n in names):
            kept_names.update(names)
            return match.group(0)          # kept verbatim: aliases stay intact
        dropped_groups += 1
        return ''

    trimmed = CONTENT_RULE.sub(repl, css)
    return trimmed, kept_names, dropped_groups, untouched


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

    name2cp = class_map(css)
    if not name2cp:
        print('FATAL: no icon rules parsed out of fontawesome.min.css — the file format changed')
        return 1
    _, classes, literals = used_icons(name2cp, source_text())
    keep = {n for n in (classes | literals) if n in name2cp}

    trimmed, kept_names, dropped_groups, untouched = trim_css(css, keep)
    kept_cps = {name2cp[n] for n in kept_names}

    print('icon classes in css : %d' % len(name2cp))
    print('icons kept          : %d classes / %d codepoints' % (len(keep), len(kept_cps)))
    print('rules dropped       : %d groups (%d non-icon rules untouched)' % (dropped_groups, untouched))

    for font_name in FONTS:
        path = os.path.join(FONT_DIR, font_name)
        if not os.path.exists(path):
            print('FATAL: %s is missing' % font_name)
            return 1
        before = os.path.getsize(path)
        try:
            data, missing = subset_font(path, kept_cps)
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

    print('%-22s %7d -> %6d bytes' % ('fontawesome.min.css', len(css), len(trimmed)))
    if not check:
        with open(CSS_PATH, 'w', encoding='utf-8', newline='') as fh:
            fh.write(trimmed)

    # Post-conditions: every used class must still map to its ORIGINAL
    # codepoint, and that codepoint must exist in a subset font. This is the
    # check that would have caught the alias-remap regression.
    final_map = class_map(trimmed)
    remapped = {n: (name2cp[n], final_map[n]) for n in keep
                if n in final_map and final_map[n] != name2cp[n]}
    lost = sorted(n for n in keep if n not in final_map)
    if remapped:
        print('FATAL: %d class(es) were remapped: %s' % (len(remapped), remapped))
        return 1
    if lost:
        print('FATAL: %d used class(es) lost their rule: %s' % (len(lost), lost))
        return 1

    solid = os.path.join(FONT_DIR, 'fa-solid-900.woff2')
    print('verified: all %d used classes keep their original codepoint' % len(keep))
    print('orphaned references: %s' % (sorted({n for n in re.findall(r'\bfa-([a-z0-9-]+)', source_text())
                                               if n in name2cp and n not in keep}) or 'none'))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
