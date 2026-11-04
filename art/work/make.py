import numpy as np, csv, math, random
from PIL import Image, ImageDraw, ImageFont, ImageFilter
from scipy import ndimage
W='work/'; OUT='samples/'
BLUE=(0x1F,0x3F,0xA8); RED=(0xD6,0x28,0x28); PURPLE=(0x71,0x1a,0x5f); GREEN=(0x2A,0x9D,0x50); ORANGE=(0xE0,0x7B,0x00); PAPER=(0xFA,0xF8,0xF2)
TYPEC={'攻击':RED,'防御':BLUE,'资源':GREEN,'效果':ORANGE}
FB='/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc'; FR='/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'
def font(p,s):
    for i in range(6):
        f=ImageFont.truetype(p,s,index=i)
        if 'SC' in f.getname()[0]: return f
    return ImageFont.truetype(p,s)
pages={}
def page(n):
    if n not in pages:
        im=np.asarray(Image.open(f'{W}pg{n}-{n:02d}.png' if n<10 else f'{W}pg{n}-{n}.png').convert('RGB')).astype(float)
        # shadow removal: divide by large-scale background estimate
        g=im.mean(2)
        bg=ndimage.maximum_filter(g[::4,::4],size=25); bg=ndimage.uniform_filter(bg,15)
        bg=np.kron(bg,np.ones((4,4)))[:g.shape[0],:g.shape[1]]
        pages[n]=(im,np.clip(im/np.maximum(bg,1)[...,None]*255,0,255))
    return pages[n]
def extract(n,box,color,only=None,scale=1.0,mask_rects=()):
    """box in full-res px. only='blue'/'black'/'red'/None filters ink by hue."""
    im,norm=page(n); x0,y0,x1,y1=box
    c=norm[y0:y1,x0:x1]; r,g,b=c[...,0],c[...,1],c[...,2]
    lum=c.mean(2); dark=np.clip((235-lum)/120,0,1)
    sat=c.max(2)-c.min(2)
    if only=='blue': dark*=np.clip((b-r-25)/30,0,1)
    elif only=='black': dark*=np.clip((60-sat)/30,0,1)
    elif only=='red': dark*=np.clip((r-b-40)/30,0,1)
    for (a,bq,cq,d) in mask_rects: dark[bq-y0:d-y0,a-x0:cq-x0]=0
    # remove specks
    lab,nl=ndimage.label(dark>0.35); sizes=ndimage.sum(np.ones_like(dark),lab,range(1,nl+1))
    keep=np.isin(lab,np.where(sizes>=60)[0]+1); keep=ndimage.binary_dilation(keep,iterations=3)
    a=(dark*keep*255).astype(np.uint8)
    ys,xs=np.where(a>40); pad=12
    a=a[max(ys.min()-pad,0):ys.max()+pad, max(xs.min()-pad,0):xs.max()+pad]
    rgba=np.zeros(a.shape+(4,),np.uint8); rgba[...,:3]=color; rgba[...,3]=a
    return Image.fromarray(rgba,'RGBA')
def fit(img,w,h,up=True):
    s=min(w/img.width,h/img.height)
    if not up: s=min(s,1)
    return img.resize((max(1,int(img.width*s)),max(1,int(img.height*s))),Image.LANCZOS)
def wobble_line(d,pts,col,w,seed):
    rnd=random.Random(seed)
    for (xa,ya),(xb,yb) in zip(pts,pts[1:]):
        d.line([(xa,ya),(xb,yb)],fill=col,width=w,joint='curve')
def handframe(d,x0,y0,x1,y1,rad,col,w,seed):
    rnd=random.Random(seed); pts=[]
    corners=[(x1-rad,y0+rad,-90),(x1-rad,y1-rad,0),(x0+rad,y1-rad,90),(x0+rad,y0+rad,180)]
    # build path clockwise starting top-left after corner, leave small gaps at corners
    segs=[]
    for k,(cx,cy,a0) in enumerate(corners):
        arc=[(cx+rad*math.cos(math.radians(a0+t)),cy+rad*math.sin(math.radians(a0+t))) for t in range(4,87,6)]
        segs.append(arc)
    # straight edges between arcs
    def jit(p,amt=1.6): return (p[0]+rnd.uniform(-amt,amt),p[1]+rnd.uniform(-amt,amt))
    for i in range(4):
        arc=segs[i]; nxt=segs[(i+1)%4]
        path=[jit(p,0.8) for p in arc]
        a=arc[-1]; b=nxt[0]; n=14
        line=[jit((a[0]+(b[0]-a[0])*t/n*0.99 + math.sin(t/n*math.pi)*rnd.uniform(-3,3), a[1]+(b[1]-a[1])*t/n*0.99+ math.sin(t/n*math.pi)*rnd.uniform(-3,3))) for t in range(n+1)]
        d.line(path+line[1:],fill=col,width=w,joint='curve')
        for p in (path[0],line[-1]): d.ellipse([p[0]-w/2,p[1]-w/2,p[0]+w/2,p[1]+w/2],fill=col)
def paper(Wd=750,H=1050):
    im=Image.new('RGBA',(Wd,H),PAPER+(255,)); d=ImageDraw.Draw(im)
    for y in range(200,H-30,38): d.line([(28,y),(Wd-28,y)],fill=(205,215,235,255),width=1)
    d.line([(90,24),(90,H-24)],fill=(240,190,190,255),width=1)
    return im
def rich_text(d,img,x,y,maxw,tokens,f,col,icons,lh):
    """tokens: list of str or ('icon',name). wraps by char."""
    cx,cy=x,y
    for t in tokens:
        items=[('icon',t[1])] if isinstance(t,tuple) else list(t)
        for it in items:
            if isinstance(it,tuple):
                ic=icons[it[1]]; wdt=ic.width+4
                if cx+wdt>x+maxw: cx=x; cy+=lh
                img.alpha_composite(ic,(int(cx),int(cy+(lh-ic.height)//2-4))); cx+=wdt; continue
            wdt=d.textlength(it,font=f)
            if it in '，。、；）' and cx+wdt>x+maxw: pass
            elif cx+wdt>x+maxw: cx=x; cy+=lh
            d.text((cx,cy),it,font=f,fill=col); cx+=wdt
    return cy+lh
rows={r['编号']:r for r in csv.DictReader(open('../cards-v2.csv',encoding='utf-8-sig'))}
# icons
def iconize(im,sz,grow):
    a=np.asarray(im)[...,3]; lab,nl=ndimage.label(a>60)
    if nl>1:
        sizes=ndimage.sum(np.ones_like(a),lab,range(1,nl+1)); big=np.argmax(sizes)+1
        # keep components whose size >= 15% of largest (face has several strokes)
        keep=np.isin(lab,[i+1 for i,s in enumerate(sizes) if s>=0.15*sizes.max()])
        a=a*ndimage.binary_dilation(keep,iterations=4)
    a=ndimage.grey_dilation(a,size=(grow,grow))
    arr=np.asarray(im).copy(); arr[...,3]=a; im=Image.fromarray(arr,'RGBA'); im=im.crop(im.getbbox())
    return fit(im,sz,sz)
heart=iconize(extract(68,(150,1000,380,1260),RED,only='red'),46,7)
face=iconize(extract(69,(600,1000,820,1260),PURPLE),46,7)
heart.save(OUT+'icon_hp.png'); face.save(OUT+'icon_sp.png')
icons={'hp':heart,'sp':face}
def series_badge(text,col):
    f=font(FB,20); w=int(ImageDraw.Draw(Image.new('L',(1,1))).textlength(text,font=f))+28
    b=Image.new('RGBA',(w,36),(0,0,0,0)); d=ImageDraw.Draw(b)
    d.rounded_rectangle([2,2,w-3,33],radius=8,outline=col+(255,),width=3,fill=(255,255,255,180))
    d.text((14,4),text,font=f,fill=col+(255,)); return b
def build(cid,src):
    r=rows[cid]; n=int(r['页码'])
    name=extract(n,src['name'],BLUE); name.save(f'{OUT}{cid}_name.png')
    art=extract(n,src['art'],BLUE,only='blue',mask_rects=src.get('mask',())); art.save(f'{OUT}{cid}_art.png')
    cost=extract(n,src['cost'],PURPLE)
    quote=extract(n,src['quote'],BLUE) if src.get('quote') else None
    if quote: quote.save(f'{OUT}{cid}_quote.png')
    typ=r['类型'].split('（')[0]; tc=TYPEC[typ]
    im=paper(); d=ImageDraw.Draw(im)
    handframe(d,18,18,732,1032,42,BLUE+(255,),6,hash(cid)%999)
    # type-colored corner ticks
    for (x,y,sx,sy) in [(30,30,1,1),(720,30,-1,1),(30,1020,1,-1),(720,1020,-1,-1)]:
        d.line([(x,y+sy*34),(x,y),(x+sx*34,y)],fill=tc+(255,),width=5,joint='curve')
    nm=fit(name,560,110); im.alpha_composite(nm,(40,36+(110-nm.height)//2))
    cs=fit(cost,96,96); im.alpha_composite(cs,(620+(96-cs.width)//2,40+(96-cs.height)//2))
    # type tag
    f=font(FB,24); d.ellipse([44,160,64,180],fill=tc+(255,))
    label=r['类型'].replace('（','·').replace('）','')+'牌' if '（' not in r['类型'] else r['类型'].split('（')[0]+'牌·'+r['类型'].split('（')[1].rstrip('）')
    d.text((72,153),label,font=f,fill=tc+(255,)); x=72+d.textlength(label,font=f)+16
    for tag in [t for t in r['标签'].replace('，',',').split(',') if t.strip()]:
        b=series_badge(tag.strip(),BLUE); im.alpha_composite(b,(int(x),152)); x+=b.width+8
    # cost SP note next to cost
    fc=fit(face,34,34); im.alpha_composite(fc,(578,72+(34-fc.height)//2))
    ar=fit(art,640,400); im.alpha_composite(ar,(40+(670-ar.width)//2,205+(410-ar.height)//2))
    # effect box
    d.rounded_rectangle([44,632,706,906],radius=18,fill=(255,255,255,170),outline=(200,208,228,255),width=2)
    fs=src.get('fs',44); lh=fs+22
    tmp=Image.new('RGBA',im.size,(0,0,0,0)); td=ImageDraw.Draw(tmp)
    yend=rich_text(td,tmp,70,0,610,src['effect'],font(FB,fs),(30,34,48,255),icons,lh)
    top=632+(274-yend)//2
    im.alpha_composite(tmp.crop((0,0,750,yend+10)),(0,top))
    if quote:
        q=fit(quote,620,82); im.alpha_composite(q,(375-q.width//2,918+(86-q.height)//2))
    d.text((706,1000),cid,font=font(FR,16),fill=(150,160,190,255),anchor='rs')
    im.convert('RGB').save(f'{OUT}{cid}_card.png'); return im
S=3.543
def T(*b): return tuple(int(v*S) for v in b)
cards={
 'XHS-001':dict(name=T(175,40,485,165),art=T(95,335,355,630),cost=T(505,105,592,195),quote=T(85,720,655,840),
    effect=['防御一次攻击，但失去下一次出牌机会。']),
 'XHS-025':dict(name=T(225,55,450,165),art=T(115,295,540,595),cost=T(525,155,625,245),quote=T(60,720,665,845),
    effect=['使敌 ',('icon','hp'),' +1。']),
 'XHS-058':dict(name=T(65,40,365,150),art=T(110,165,630,712),cost=T(510,60,610,158),quote=None,
    mask=[T(180,640,640,712),T(470,165,640,600)],
    effect=['持续有效。','所有与 3118 有关手牌的有益效果 ×2。'],fs=42),
}
outs=[build(k,v) for k,v in cards.items()]
pv=Image.new('RGB',(750*3+40*4,1050+80),(230,226,216))
for i,c in enumerate(outs): pv.paste(c.convert('RGB'),(40+i*790,40))
pv.save(OUT+'preview.png')
print('done')
