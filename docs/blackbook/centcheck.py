import subprocess, re, statistics

PDF = "/home/catlium/Code/EduTech/docs/blackbook/output/main.pdf"

def words_bbox(p):
    o = subprocess.run(["pdftotext","-f",str(p),"-l",str(p),"-bbox",PDF,"-"],
                       capture_output=True,text=True).stdout
    return re.findall(r'xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]+)</word>', o)

def text(p):
    return subprocess.run(["pdftotext","-f",str(p),"-l",str(p),"-layout",PDF,"-"],
                          capture_output=True,text=True).stdout

def isblank(p):
    o = subprocess.run(["pdftotext","-f",str(p),"-l",str(p),"-bbox",PDF,"-"],
                       capture_output=True,text=True).stdout
    return not re.findall(r'<word>', o)

n = int(subprocess.run(["pdfinfo",PDF],capture_output=True,text=True).stdout
        .split("Pages:")[1].split()[0])

def title_center(p):
    ws = words_bbox(p)
    if not ws: return None, None
    # title block = words in the topmost visual band (first ~two lines)
    ytop = min(float(w[1]) for w in ws)
    band = [w for w in ws if float(w[1]) < ytop + 60]
    ys = [(float(w[1]) + float(w[3])) / 2 for w in band]
    xs = [(float(w[0]) + float(w[2])) / 2 for w in ws]
    return sum(ys)/len(ys), sum(xs)/len(xs)

# text block: margin .90in top/bottom on 612pt page -> text spans y 64.8..727.2
# vertical middle = (64.8+727.2)/2 = 396.0 ; horizontal middle = 320.4 (recto)
VTARGET, HTARGET = 396.0, 320.4

print(f"pages={n}\n")
print("Numbered chapter openers (must be CENTERED vertically ~396 and at recto-CX):")
for p in range(1, n+1):
    t = text(p).strip()
    if not t.startswith("CHAPTER 1") and not t.startswith("CHAPTER 2") and \
       not t.startswith("CHAPTER 3") and not t.startswith("CHAPTER 4") and \
       not t.startswith("CHAPTER 5") and not t.startswith("CHAPTER 6") and \
       not t.startswith("CHAPTER 7") and not t.startswith("CHAPTER 8"):
        continue
    ctr, cx = title_center(p)
    ok = ctr is not None and abs(ctr-VTARGET) < 20 and abs(cx-HTARGET) < 12
    print(f"  P{p:3d} {t.splitlines()[0][:28]:28} titleCY={ctr:6.1f} titleCX={cx:6.1f}  {'CENTERED' if ok else 'MISPLACED'}")

print("\nFront-matter \\chapter* openers (must be TOP-aligned: titleCY well above 396):")
for p in range(1, n+1):
    t = text(p).strip()
    f = t.splitlines()[0] if t else ""
    if re.match(r"^(CERTIFICATE|DECLARATION|ACKNOWLEDGEMENT|ABSTRACT|GLOSSARY|ABBREVIATIONS|LIST OF|TABLE OF|GLOSS)", f, re.I):
        ctr, cx = title_center(p)
        top = ctr is not None and ctr < 300
        print(f"  P{p:3d} {f[:34]:34} titleCY={ctr:6.1f}  {'TOP-ALIGNED' if top else 'CENTERED?!'}")
