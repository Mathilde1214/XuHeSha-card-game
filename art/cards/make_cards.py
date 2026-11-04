# 《续禾杀》卡面批量生成：由 art/work/make.py（已通过的样卡流程）泛化而来。
# 用法：cd /workspace/xuhesha/art/cards && python3 make_cards.py [XHS-001 ...]
import numpy as np, csv, math, random, json, re, sys, os
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage
from fontTools.ttLib import TTFont
HERE=os.path.dirname(os.path.abspath(__file__))
ROOT=os.path.abspath(os.path.join(HERE,'..','..'))
PAGES=f'{HERE}/assets/pages/'; A=f'{HERE}/assets/'; OUT=f'{HERE}/'
BLUE=(0x1F,0x3F,0xA8); RED=(0xD6,0x28,0x28); PURPLE=(0x71,0x1a,0x5f); GREEN=(0x2A,0x9D,0x50); ORANGE=(0xE0,0x7B,0x00); PAPER=(0xFA,0xF8,0xF2)
TYPEC={'攻击':RED,'防御':BLUE,'资源':GREEN,'效果':ORANGE}
FB='/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc'; FR='/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'
FH=f'{A}fonts/ZCOOLKuaiLe-Regular.ttf'
HCMAP=TTFont(FH).getBestCmap()
S=2480/700
_fc={}
def font(p,s):
    k=(p,s)
    if k in _fc: return _fc[k]
    if p.endswith('.ttf'): f=ImageFont.truetype(p,s)
    else:
        f=None
        for i in range(6):
            g=ImageFont.truetype(p,s,index=i)
            if 'SC' in g.getname()[0]: f=g; break
        f=f or ImageFont.truetype(p,s)
    _fc[k]=f; return f
pages={}
def page(n):
    if n not in pages:
        img=Image.open(f'{PAGES}pg-{n:02d}.png').convert('RGB')
        if img.size!=(2480,3509): img=img.resize((2480,3509),Image.LANCZOS)  # p33 landscape scan
        im=np.asarray(img).astype(float); g=im.mean(2)
        bg=ndimage.maximum_filter(g[::4,::4],size=25); bg=ndimage.uniform_filter(bg,15)
        bg=np.kron(bg,np.ones((4,4)))[:g.shape[0],:g.shape[1]]
        pages[n]=(im,np.clip(im/np.maximum(bg,1)[...,None]*255,0,255))
    return pages[n]
def T(b): return tuple(int(v*S) for v in b)
def extract(n,box,color,only=None,mask_rects=(),minsize=60):
    im,norm=page(n); x0,y0,x1,y1=T(box)
    c=norm[y0:y1,x0:x1]; r,g,b=c[...,0],c[...,1],c[...,2]
    lum=c.mean(2); dark=np.clip((235-lum)/120,0,1); sat=c.max(2)-c.min(2)
    if only=='blue': dark*=np.clip((b-r-25)/30,0,1)
    elif only=='black': dark*=np.clip((60-sat)/30,0,1)
    elif only=='red': dark*=np.clip((r-b-40)/30,0,1)
    for m in mask_rects:
        a,bq,cq,d=T(m); dark[max(bq-y0,0):max(d-y0,0),max(a-x0,0):max(cq-x0,0)]=0
    lab,nl=ndimage.label(dark>0.35); sizes=ndimage.sum(np.ones_like(dark),lab,range(1,nl+1))
    keep=np.isin(lab,np.where(sizes>=minsize)[0]+1); keep=ndimage.binary_dilation(keep,iterations=3)
    a=(dark*keep*255).astype(np.uint8)
    ys,xs=np.where(a>40); pad=12
    if len(ys)==0: raise ValueError(f'empty crop p{n} {box}')
    a=a[max(ys.min()-pad,0):ys.max()+pad, max(xs.min()-pad,0):xs.max()+pad]
    rgba=np.zeros(a.shape+(4,),np.uint8); rgba[...,:3]=color; rgba[...,3]=a
    return Image.fromarray(rgba,'RGBA')
def fit(img,w,h,up=True):
    s=min(w/img.width,h/img.height)
    if not up: s=min(s,1)
    return img.resize((max(1,int(img.width*s)),max(1,int(img.height*s))),Image.LANCZOS)
def handframe(d,x0,y0,x1,y1,rad,col,w,seed):
    rnd=random.Random(seed)
    corners=[(x1-rad,y0+rad,-90),(x1-rad,y1-rad,0),(x0+rad,y1-rad,90),(x0+rad,y0+rad,180)]
    segs=[[(cx+rad*math.cos(math.radians(a0+t)),cy+rad*math.sin(math.radians(a0+t))) for t in range(4,87,6)] for cx,cy,a0 in corners]
    def jit(p,amt=1.6): return (p[0]+rnd.uniform(-amt,amt),p[1]+rnd.uniform(-amt,amt))
    for i in range(4):
        arc=segs[i]; nxt=segs[(i+1)%4]; path=[jit(p,0.8) for p in arc]
        a=arc[-1]; b=nxt[0]; n=14
        line=[jit((a[0]+(b[0]-a[0])*t/n*0.99+math.sin(t/n*math.pi)*rnd.uniform(-3,3), a[1]+(b[1]-a[1])*t/n*0.99+math.sin(t/n*math.pi)*rnd.uniform(-3,3))) for t in range(n+1)]
        d.line(path+line[1:],fill=col,width=w,joint='curve')
        for p in (path[0],line[-1]): d.ellipse([p[0]-w/2,p[1]-w/2,p[0]+w/2,p[1]+w/2],fill=col)
def paper(Wd=750,H=1050):
    im=Image.new('RGBA',(Wd,H),PAPER+(255,)); d=ImageDraw.Draw(im)
    for y in range(200,H-30,38): d.line([(28,y),(Wd-28,y)],fill=(205,215,235,255),width=1)
    d.line([(90,24),(90,H-24)],fill=(240,190,190,255),width=1)
    return im
def rich_text(d,img,x,y,maxw,tokens,f,col,icons,lh):
    cx,cy=x,y
    for t in tokens:
        items=[('icon',t[1])] if isinstance(t,tuple) else list(t)
        for it in items:
            if isinstance(it,tuple):
                ic=icons[it[1]]; wdt=ic.width+4
                if cx+wdt>x+maxw: cx=x; cy+=lh
                img.alpha_composite(ic,(int(cx),int(cy+(lh-ic.height)//2-4))); cx+=wdt; continue
            wdt=d.textlength(it,font=f)
            if it in '，。、；）”：' and cx+wdt>x+maxw+wdt*0.9: cx=x; cy+=lh
            elif it in '，。、；）”：' and cx+wdt>x+maxw: pass
            elif cx+wdt>x+maxw: cx=x; cy+=lh
            if it==' ' and cx==x: continue
            d.text((cx,cy),it,font=f,fill=col); cx+=wdt
    return cy+lh
def hand_text_img(text,size,col,maxw=None):
    """typeset text with the handwriting font, per-char fallback to Noto for missing glyphs."""
    fh=font(FH,size); fn=font(FB,int(size*0.9))
    tmp=Image.new('L',(1,1)); d=ImageDraw.Draw(tmp)
    ws=[d.textlength(ch,font=fh if ord(ch) in HCMAP else fn) for ch in text]
    w=int(sum(ws))+20; h=int(size*1.4)
    im=Image.new('RGBA',(w,h),(0,0,0,0)); d=ImageDraw.Draw(im); x=10
    for ch,wd in zip(text,ws):
        f=fh if ord(ch) in HCMAP else fn
        d.text((x,h*0.5),ch,font=f,fill=col+(255,),anchor='lm'); x+=wd
    return im.crop(im.getbbox())
def iconize(im,sz,grow):
    a=np.asarray(im)[...,3]; lab,nl=ndimage.label(a>60)
    if nl>1:
        sizes=ndimage.sum(np.ones_like(a),lab,range(1,nl+1))
        keep=np.isin(lab,[i+1 for i,s in enumerate(sizes) if s>=0.15*sizes.max()])
        a=a*ndimage.binary_dilation(keep,iterations=4)
    a=ndimage.grey_dilation(a,size=(grow,grow))
    arr=np.asarray(im).copy(); arr[...,3]=a; im=Image.fromarray(arr,'RGBA'); im=im.crop(im.getbbox())
    return fit(im,sz,sz)
# ---------- data ----------
rows={r['编号']:r for r in csv.DictReader(open(f'{ROOT}/cards-v2.csv',encoding='utf-8-sig'))}
CFG=json.load(open(f'{HERE}/card_config.json',encoding='utf-8'))
# ---------- shared assets ----------
os.makedirs(A,exist_ok=True)
heart=Image.open(f'{ROOT}/art/samples/icon_hp.png').convert('RGBA'); face=Image.open(f'{ROOT}/art/samples/icon_sp.png').convert('RGBA')
heart.save(A+'icon_hp.png'); face.save(A+'icon_sp.png')
icons={'hp':heart,'sp':face}
zero=extract(36,CFG['_zero_src'],PURPLE); zero.save(A+'cost_zero_from_XHS-036.png')
shark=extract(15,CFG['_shark_src'],BLUE,only='blue'); shark=fit(shark.crop(shark.getbbox()),60,30); shark.save(A+'icon_shark.png')
def series_badge(text,col,icon=None):
    f=font(FB,20); tw=int(ImageDraw.Draw(Image.new('L',(1,1))).textlength(text,font=f))
    iw=(icon.width+6) if icon else 0
    w=tw+28+iw
    b=Image.new('RGBA',(w,36),(0,0,0,0)); d=ImageDraw.Draw(b)
    d.rounded_rectangle([2,2,w-3,33],radius=8,outline=col+(255,),width=3,fill=(255,255,255,180))
    if icon: b.alpha_composite(icon,(10,(36-icon.height)//2))
    d.text((14+iw,4),text,font=f,fill=col+(255,)); return b
def tokens_for(text):
    parts=re.split(r'(HP|SP)',text); out=[]
    for p in parts:
        if p=='HP': out.append(('icon','hp'))
        elif p=='SP': out.append(('icon','sp'))
        elif p: out.append(p)
    return out
NOQUOTE={'','（无）','（无单独台词）'}
LOG={}
def hcat(imgs,gap=22):
    h=max(i.height for i in imgs); imgs=[i.resize((max(1,int(i.width*h/i.height)),h),Image.LANCZOS) for i in imgs]
    out=Image.new('RGBA',(sum(i.width for i in imgs)+gap*(len(imgs)-1),h),(0,0,0,0)); x=0
    for i in imgs: out.alpha_composite(i,(x,0)); x+=i.width+gap
    return out
def note(cid,msg): LOG.setdefault(cid,[]).append(msg)
def build(cid):
    r=rows[cid]; src=CFG.get(cid,{}); n=int(r['页码'])
    os.makedirs(A+cid,exist_ok=True); ad=A+cid+'/'
    # name
    if src.get('name_font') or not src.get('name'):
        nameimg=hand_text_img(r['卡名'],96,BLUE); note(cid,'卡名用仿手写字体排字')
    elif src.get('name_parts'):
        nameimg=hcat([extract(n,b,BLUE,only=src.get('name_only')) for b in src['name_parts']]); note(cid,'手写卡名原为两行，裁成两段拼成一行')
    else:
        nameimg=extract(n,src['name'],BLUE,only=src.get('name_only'))
    nameimg.save(ad+'name.png')
    # cost
    if src.get('zero'): cost=zero
    elif src.get('cost_text'):
        t=hand_text_img(src['cost_text'],52,PURPLE); cost=Image.new('RGBA',(t.width+40,96),(0,0,0,0)); d=ImageDraw.Draw(cost)
        d.ellipse([3,3,cost.width-4,92],outline=PURPLE+(255,),width=6); cost.alpha_composite(t,((cost.width-t.width)//2,(96-t.height)//2))
        note(cid,f'卡面无费用圈，按 csv 排字费用 {src["cost_text"]}')
    else: cost=extract(n,src['cost'],PURPLE)
    cost.save(ad+'cost.png')
    # art / quote
    quote_text=r['卡面台词'].strip()
    has_quote=quote_text not in NOQUOTE
    quote=None; art=None
    if src.get('quote_as_art'):
        art=extract(n,src['quote'],BLUE,only=src.get('quote_only'),mask_rects=src.get('quote_mask',()))
        note(cid,'手写台词就是卡面主图，放进插画区，底部不重复台词')
    else:
        if src.get('art'): art=extract(n,src['art'],BLUE,only=src.get('art_only','blue'),mask_rects=src.get('art_mask',()))
        if has_quote:
            if src.get('quote_font') or not src.get('quote'):
                qt=quote_text if quote_text[:1] in '“「"' else f'“{quote_text}”'
                quote=('font',qt); note(cid,'台词用仿手写字体排字')
            elif src.get('quote_parts'):
                quote=hcat([extract(n,b,BLUE,only=src.get('quote_only')) for b in src['quote_parts']]); note(cid,'手写台词原为多段，裁开后拼成一行')
            else: quote=extract(n,src['quote'],BLUE,only=src.get('quote_only'),mask_rects=src.get('quote_mask',()))
    if art is not None: art.save(ad+'art.png')
    if isinstance(quote,Image.Image): quote.save(ad+'quote.png')
    typ=r['类型'].split('（')[0]; tc=TYPEC[typ]
    im=paper(); d=ImageDraw.Draw(im)
    handframe(d,18,18,732,1032,42,BLUE+(255,),6,int(cid[-3:])*37)
    for (x,y,sx,sy) in [(30,30,1,1),(720,30,-1,1),(30,1020,1,-1),(720,1020,-1,-1)]:
        d.line([(x,y+sy*34),(x,y),(x+sx*34,y)],fill=tc+(255,),width=5,joint='curve')
    # cost (right aligned at 716), SP face to its left
    cs=fit(cost,96,96) if cost.width<=cost.height*1.4 else fit(cost,210,90)
    cx0=716-max(cs.width,96)
    im.alpha_composite(cs,(cx0+(max(cs.width,96)-cs.width)//2,40+(96-cs.height)//2))
    fc=fit(face,34,34); fx=cx0-42; im.alpha_composite(fc,(fx,72+(34-fc.height)//2))
    # name
    nmw=fx-10-40
    nm=fit(nameimg,nmw,110); im.alpha_composite(nm,(40,36+(110-nm.height)//2))
    # type tag + series badges
    f=font(FB,24); d.ellipse([44,160,64,180],fill=tc+(255,))
    label=r['类型']+'牌' if '（' not in r['类型'] else r['类型'].split('（')[0]+'牌·'+r['类型'].split('（')[1].rstrip('）')
    d.text((72,153),label,font=f,fill=tc+(255,)); x=72+d.textlength(label,font=f)+16
    for tag in [t.strip() for t in re.split('[、,，]',r['标签']) if t.strip()]:
        b=series_badge(tag,BLUE,shark if tag=='鲨鲨' else None); im.alpha_composite(b,(int(x),152)); x+=b.width+8
    # art
    if art is not None:
        ar=fit(art,640,400); im.alpha_composite(ar,(40+(670-ar.width)//2,205+(410-ar.height)//2))
    # effect box
    d.rounded_rectangle([44,632,706,906],radius=18,fill=(255,255,255,170),outline=(200,208,228,255),width=2)
    eff=src.get('effect_override') or r['效果原文']
    if src.get('effect_override'): note(cid,f'效果栏排字用覆盖文本（csv 原文：{r["效果原文"]}）')
    if eff.startswith('（') and eff.endswith('）') and not src.get('effect_override'):
        note(cid,f'csv 效果原文是说明文字「{eff}」，效果栏留空'); eff=''
    if eff:
        for fs in range(44,21,-2):
            lh=int(fs*1.45)
            tmp=Image.new('RGBA',im.size,(0,0,0,0)); td=ImageDraw.Draw(tmp)
            ic={k:fit(v,int(fs*1.05),int(fs*1.05)) for k,v in icons.items()}
            yend=rich_text(td,tmp,70,0,610,tokens_for(eff),font(FB,fs),(30,34,48,255),ic,lh)
            if yend<=252: break
        if fs<44: note(cid,f'效果文字缩到 {fs}px') if fs<32 else None
        top=632+(274-yend)//2
        im.alpha_composite(tmp.crop((0,0,750,yend+10)),(0,top))
    # quote
    if quote is not None:
        if isinstance(quote,tuple):
            q=hand_text_img(quote[1],60,BLUE)
        else: q=quote
        q=fit(q,620,82); im.alpha_composite(q,(375-q.width//2,918+(86-q.height)//2))
    d.text((706,1000),cid,font=font(FR,16),fill=(150,160,190,255),anchor='rs')
    im.convert('RGB').save(f'{OUT}{cid}_card.png'); return im
if __name__=='__main__':
    ids=sys.argv[1:] or [k for k,r in rows.items() if r['状态']=='有效']
    for cid in ids:
        build(cid); pages.clear(); print(cid,"ok",flush=True)
    json.dump(LOG,open(f'{A}build_notes.json','w'),ensure_ascii=False,indent=1)
    if not sys.argv[1:]:
        live=[k for k,r in rows.items() if r['状态']=='有效']
        per=12; cols=4; tw,th=375,525
        for si in range(0,len(live),per):
            chunk=live[si:si+per]; rws=math.ceil(len(chunk)/cols)
            sh=Image.new('RGB',(cols*(tw+20)+20,rws*(th+20)+20),(230,226,216))
            for i,cid in enumerate(chunk):
                c=Image.open(f'{OUT}{cid}_card.png').resize((tw,th),Image.LANCZOS)
                sh.paste(c,(20+(i%cols)*(tw+20),20+(i//cols)*(th+20)))
            sh.save(f'{OUT}sheet_{si//per+1}.png')
        print('sheets done')
