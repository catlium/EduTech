import subprocess, re

PDF = "/home/catlium/Code/EduTech/docs/blackbook/output/main.pdf"

def text(p):
    return subprocess.run(["pdftotext","-f",str(p),"-l",str(p),"-layout",PDF,"-"],
                          capture_output=True,text=True).stdout

def words_bbox(p):
    b = subprocess.run(["pdftotext","-f",str(p),"-l",str(p),"-bbox",PDF,"-"],
                       capture_output=True,text=True).stdout
    return re.findall(r'xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)"[^>]*>([^<]+)</word>', b)

n = int(subprocess.run(["pdfinfo",PDF],capture_output=True,text=True)
        .stdout.split("Pages:")[1].split()[0])

blanks=[]; numerals=[]
for p in range(1,n+1):
    t = text(p).strip()
    if not t:
        blanks.append(p)
    else:
        ws = [(float(a),float(y),float(c),w) for a,y,c,w in words_bbox(p)]
        caps = [w for w in ws if re.fullmatch(r"[ivxlcdmIVXLCDM]+", w[3])]
        if caps and len(caps)==1 and caps[0][3].lower()==caps[0][3]:
            numerals.append((p,caps[0][3]))

print(f"pdf pages               : {n}")
print(f"inserted BLANK pages   : {len(blanks)} -> {blanks}")
print(f"all blanks truly empty : {all(not text(b).strip() for b in blanks)}")
print(f"pages carrying a NUMERAL (must all be non-blank frontmatter/body):")
for p,rn in numerals: print(f"   P{p}: '{rn}'")
bad = [b for b in blanks if any(p for p,rn in numerals if p==b)]
print(f"WARNING numerals-on-blanks: {bad if bad else 'NONE'}")
