def lum(h):
    h=h.lstrip('#'); c=[int(h[i:i+2],16)/255 for i in (0,2,4)]
    c=[x/12.92 if x<=0.04045 else ((x+0.055)/1.055)**2.4 for x in c]
    return 0.2126*c[0]+0.7152*c[1]+0.0722*c[2]
def cr(a,b):
    la,lb=sorted([lum(a),lum(b)],reverse=True); return (la+0.05)/(lb+0.05)
if __name__=="__main__":
    pairs=[("#f3efe6","#12161a"),("#c9c3b6","#12161a"),("#d2ee9a","#12161a"),("#f3efe6","#1b2127"),("#c9c3b6","#1b2127"),("#d2ee9a","#1b2127"),
           ("#8e9aa8","#12161a"),("#6f7c8b","#12161a"),("#3a434d","#12161a"),("#12161a","#f3efe6"),("#6f7c8b","#f3efe6"),("#56626f","#f3efe6"),("#3d4650","#f3efe6"),
           ("#d2ee9a","#8e9aa8"),("#d2ee9a","#6f7c8b"),("#12161a","#d2ee9a"),("#b7c2cf","#12161a"),("#a9b4c1","#12161a")]
    for a,b in pairs: print(f"{a} on {b}: {cr(a,b):.2f}")
