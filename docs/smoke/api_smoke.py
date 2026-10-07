import re, io, json, time, subprocess, uuid, urllib.parse, datetime
import requests
from PIL import Image

API='http://localhost:8000'; ORIGIN='http://localhost:5173'
LOG='/tmp/claude-0/smoke/server.log'
PW='Demo-pass-12345!'
results=[]
def check(name, cond, extra=''):
    results.append((name,bool(cond))); print(('PASS' if cond else 'FAIL'), name, extra if not cond else '')
def last_link(pattern, since):
    for _ in range(20):
        txt=open(LOG,errors='ignore').read()[since:]
        m=re.findall(pattern, txt)
        if m: return urllib.parse.unquote(m[-1] if isinstance(m[-1],str) else m[-1][0])
        time.sleep(0.3)
    raise RuntimeError('no link '+pattern)
def logsize(): return len(open(LOG,errors='ignore').read())

class Client:
    def __init__(self): self.s=requests.Session(); self.access=None
    def h(self,extra=None):
        h={'Origin':ORIGIN}
        if self.access: h['Authorization']='Bearer '+self.access
        h.update(extra or {}); return h
    def req(self,m,path,**kw):
        return self.s.request(m,API+path,headers=self.h(kw.pop('headers',None)),**kw)
    def login(self,email,pw):
        r=self.req('post','/api/auth/token/',json={'email':email,'password':pw})
        if r.status_code==200: self.access=r.json()['access']
        return r
    def csrf(self): return self.req('get','/api/auth/csrf/').json()['csrfToken']
    def refresh(self):
        t=self.csrf(); r=self.req('post','/api/auth/token/refresh/',headers={'X-CSRFToken':t})
        if r.status_code==200: self.access=r.json()['access']
        return r
    def logout(self):
        t=self.csrf(); return self.req('post','/api/auth/token/blacklist/',headers={'X-CSRFToken':t})

def shell(code):
    out=subprocess.run(['bash','-lc',f"cd /home/claude/proj/bludhaven/backend && source .venv/bin/activate && python manage.py shell -c \"{code}\""],capture_output=True,text=True)
    return out.stdout.strip().splitlines()[-1] if out.stdout.strip() else out.stderr[-300:]

tag=uuid.uuid4().hex[:6]
guest_email=f'smoke-guest-{tag}@example.com'; host_email=f'smoke-host-{tag}@example.com'
today=datetime.date.today()
d=lambda n:(today+datetime.timedelta(days=n)).isoformat()

check('health', requests.get(API+'/api/health/').json()=={'status':'ok'})

# --- End User registration, verification, login, refresh
guest=Client(); mark=logsize()
r=guest.req('post','/api/auth/register/',json={'email':guest_email,'full_name':'Smoke Guest','password':PW}); check('register end user',r.status_code==201 and r.json()['role']=='END_USER' and r.json()['is_email_verified'] is False, r.text)
r=guest.req('post','/api/auth/register/',json={'email':f'x{guest_email}','full_name':'X','password':PW,'role':'SUPER_ADMIN'}); check('register rejects role field',r.status_code==400)
tok=last_link(r'verify-email\?token=([^\s"<&]+)',mark)
r=guest.login(guest_email,PW); check('login (unverified)',r.status_code==200 and 'refresh' not in r.json())
check('refresh cookie httpOnly',any(c.name=='bludhaven_refresh' and c.has_nonstandard_attr('HttpOnly') for c in guest.s.cookies))
r=guest.req('post','/api/bookings/',json={'property':1,'check_in':d(5),'check_out':d(7),'guests_count':1}); check('unverified cannot book (email_not_verified)',r.status_code==403 and r.json()['error']['code']=='email_not_verified', r.text)
r=guest.req('post','/api/auth/verify-email/',json={'token':tok}); check('verify email',r.status_code==200, r.text)
r=guest.req('post','/api/auth/verify-email/',json={'token':'garbage'}); check('bad verify token rejected',r.status_code==400)
r=guest.refresh(); check('session restoration: refresh with cookie+CSRF',r.status_code==200)
r=guest.req('post','/api/auth/token/refresh/'); check('refresh without CSRF rejected',r.status_code==403, r.text)
me=guest.req('get','/api/auth/me/').json(); check('me verified',me['is_email_verified'] is True and me['role']=='END_USER')

# --- Browse / filter / search
pub=Client()
r=pub.req('get','/api/properties/?page_size=5'); check('browse properties',r.status_code==200 and r.json()['count']>0)
cnt=r.json()['count']
r=pub.req('get','/api/properties/?property_type=CABIN&min_price=1000&max_price=20000&guests=2&ordering=price_per_night'); check('filter/order',r.status_code==200 and 0<r.json()['count']<=cnt, r.text[:200])
r=pub.req('get','/api/properties/?search=lake'); check('search',r.status_code==200)
r=pub.req('get',f'/api/properties/?check_in={d(5)}&check_out={d(7)}'); check('availability filter',r.status_code==200)

# --- Admin: invite host
admin=Client(); r=admin.login('demo-admin@demo.bludhaven.test',PW); check('admin login',r.status_code==200 and r.json()['user']['role']=='SUPER_ADMIN')
mark=logsize()
r=admin.req('post','/api/users/',json={'email':host_email,'full_name':'Smoke Host','role':'HOST'}); check('admin invites host',r.status_code==201, r.text); host_id=r.json()['id']
r=admin.req('post','/api/users/',json={'email':f'z{host_email}','full_name':'Z','role':'SUPER_ADMIN'}); check('cannot invite a Super Admin',r.status_code==400, r.text)
link=last_link(r'reset-password\?uid=([^\s"<]+)',mark); uid,token=re.match(r'([^&]+)&token=(.+)',link).groups()
newpw='Host-pass-67890!'
r=pub.req('post','/api/auth/password-reset/confirm/',json={'uid':uid,'token':token,'new_password':newpw}); check('invited host sets password via emailed link',r.status_code==200, r.text)
r=pub.req('post','/api/auth/password-reset/confirm/',json={'uid':uid,'token':token,'new_password':newpw+'x'}); check('invitation link is single use',r.status_code==400)
host=Client(); r=host.login(host_email,newpw); check('host login (verified by invitation)',r.status_code==200 and r.json()['user']['is_email_verified'])

# --- Subscription enforcement
dest=pub.req('get','/api/destinations/').json()['results'][0]['id']
body={'title':'Smoke Cabin','description':'Smoke test cabin.','property_type':'CABIN','destination':dest,'locality':'Test Ridge','price_per_night':'2000.00','max_guests':3,'bedrooms':1,'bathrooms':1}
r=host.req('post','/api/properties/',json=body); check('no subscription -> cannot create property',r.status_code==403 and r.json()['error']['code']=='subscription_required', r.text)
r=admin.req('post','/api/plans/',json={'name':f'Smoke plan {tag}','description':'','price':'100.00','duration_days':30,'features':{'max_properties':1,'max_images_per_property':2},'is_active':True}); check('admin creates plan',r.status_code==201, r.text); plan=r.json()['id']
check('plans are public',any(p['id']==plan for p in pub.req('get','/api/plans/?page_size=100').json()['results']))
r=admin.req('post','/api/subscriptions/',json={'user':host_id,'plan':plan}); check('admin assigns subscription',r.status_code==201, r.text); sub=r.json()
r=host.req('get','/api/subscriptions/current/'); check('host sees current subscription + usage',r.status_code==200 and r.json()['subscription']['id']==sub['id'], r.text[:200])
r=host.req('post','/api/properties/',json=body); check('host creates property',r.status_code==201, r.text); prop=r.json()['id']
r=host.req('post','/api/properties/',json={**body,'title':'Second'}); check('property limit enforced',r.status_code==403 and r.json()['error']['code']=='plan_limit_reached', r.text)
def png(): b=io.BytesIO(); Image.new('RGB',(64,48),(20,100,140)).save(b,'PNG'); return b.getvalue()
imgs=[]
for i in range(2):
    r=host.req('post',f'/api/properties/{prop}/images/',files={'image':('a.png',png(),'image/png')},data={'alt_text':f'Photo {i}'}); check(f'host uploads image {i+1}',r.status_code==201, r.text); imgs.append(r.json())
r=host.req('post',f'/api/properties/{prop}/images/',files={'image':('a.png',png(),'image/png')}); check('image limit enforced',r.status_code==403 and r.json()['error']['code']=='plan_limit_reached', r.text)
r=host.req('post',f'/api/properties/{prop}/images/',files={'image':('a.txt',b'not an image','text/plain')}); check('non-image upload refused',r.status_code in (400,403,415), r.text)
check('no storage key/public id exposed',all('storage_key' not in i and 'public_id' not in i for i in imgs))
r=host.req('patch',f'/api/properties/{prop}/images/{imgs[0]["id"]}/',json={'alt_text':'Cover'}); check('edit alt text',r.status_code==200)
r=admin.req('post',f'/api/subscriptions/{sub["id"]}/renew/',json={}); exp_old=sub['expiry_date']; check('admin renews (extends from current expiry)',r.status_code==200 and r.json()['expiry_date']>exp_old, r.text)
r=admin.req('patch',f'/api/properties/{prop}/',json={'title':'Smoke Cabin (edited by admin)'}); check('admin edits host property',r.status_code==200, r.text)
other=Client(); other.login('demo-host@demo.bludhaven.test',PW)
r=other.req('patch',f'/api/properties/{prop}/',json={'title':'hijack'}); check('other host cannot edit',r.status_code==403)
r=guest.req('patch',f'/api/properties/{prop}/',json={'title':'hijack'}); check('end user cannot edit',r.status_code==403)

# --- Favourite
r=guest.req('post','/api/favourites/',json={'property_id':prop}); check('favourite add',r.status_code in (200,201)); fid=r.json()['id']
check('favourite listed',any(f['property']['id']==prop for f in guest.req('get','/api/favourites/').json()['results']))
r=guest.req('delete',f'/api/favourites/{fid}/'); check('favourite remove',r.status_code==204)

# --- Availability + booking workflow
r=pub.req('get',f'/api/properties/{prop}/availability/'); check('availability empty',r.status_code==200 and r.json()['blocked']==[])
r=guest.req('post','/api/bookings/',json={'property':prop,'check_in':d(10),'check_out':d(13),'guests_count':2}); check('guest creates booking (server price)',r.status_code==201 and r.json()['status']=='PENDING' and r.json()['total_price']=='6000.00', r.text); b1=r.json()['id']
r=pub.req('get',f'/api/properties/{prop}/availability/'); check('availability shows blocked range',r.json()['blocked']==[{'start':d(10),'end':d(13)}], r.text); check('availability leaks nothing private','guest' not in r.text and 'email' not in r.text and 'price' not in r.text)
r=guest.req('post','/api/bookings/',json={'property':prop,'check_in':d(12),'check_out':d(14),'guests_count':2}); check('overlap refused (dates_unavailable)',r.status_code==409 and r.json()['error']['code']=='dates_unavailable')
r=guest.req('post','/api/bookings/',json={'property':prop,'check_in':d(13),'check_out':d(15),'guests_count':9}); check('too many guests refused',r.status_code==400)
r=host.req('post',f'/api/bookings/{b1}/confirm/'); check('host confirms booking',r.status_code==200 and r.json()['status']=='CONFIRMED')
r=guest.req('post',f'/api/bookings/{b1}/confirm/'); check('guest cannot confirm',r.status_code in (403,409))
r=host.req('post',f'/api/bookings/{b1}/complete/'); check('complete before check-out refused',r.status_code==409 and r.json()['error']['code']=='stay_not_finished')
r=guest.req('post','/api/bookings/',json={'property':prop,'check_in':d(20),'check_out':d(22),'guests_count':1}); b2=r.json()['id']
r=guest.req('post',f'/api/bookings/{b2}/cancel/'); check('guest cancels booking',r.status_code==200 and r.json()['status']=='CANCELLED')
check('cancelled booking frees the dates',pub.req('get',f'/api/properties/{prop}/availability/').json()['blocked']==[{'start':d(10),'end':d(13)}])
# backdate b1 so the stay is over
print('backdate:',shell(f"from apps.bookings.models import Booking; import datetime; t=datetime.date.today(); Booking.objects.filter(pk={b1}).update(check_in=t-datetime.timedelta(days=6), check_out=t-datetime.timedelta(days=3)); print('ok')"))
r=host.req('post',f'/api/bookings/{b1}/complete/'); check('host completes booking',r.status_code==200 and r.json()['status']=='COMPLETED', r.text)
r=host.req('post','/api/reviews/',json={'booking':b1,'rating':5}); check('host cannot review',r.status_code==403)
r=guest.req('post','/api/reviews/',json={'booking':b1,'rating':5,'comment':'Great smoke stay'}); check('end user reviews completed stay',r.status_code==201, r.text)
r=guest.req('post','/api/reviews/',json={'booking':b1,'rating':1}); check('duplicate review refused',r.status_code==400)
r=guest.req('get',f'/api/bookings/{b1}/'); check('booking carries its own review',r.json()['review'] and r.json()['review']['rating']==5)
r=pub.req('get',f'/api/properties/{prop}/'); check('property rating updated',r.json()['average_rating']==5 and r.json()['review_count']==1)

# --- Admin management
r=admin.req('get','/api/users/?role=HOST&search=smoke'); check('admin lists users',r.status_code==200 and r.json()['count']>=1)
for path in ('/api/bookings/','/api/subscriptions/','/api/billing-profiles/'):
    check('admin '+path,admin.req('get',path).status_code==200)
check('host cannot use /api/users/',host.req('get','/api/users/').status_code==403)
r=admin.req('patch',f'/api/users/{host_id}/',json={'role':'SUPER_ADMIN'}); check('no promotion to Super Admin',r.status_code==400, r.text)

# --- Profile and password change
r=guest.req('patch','/api/auth/me/',json={'full_name':'Smoke Guest Renamed'}); check('profile rename',r.status_code==200 and r.json()['full_name']=='Smoke Guest Renamed')
r=guest.req('patch','/api/auth/me/',json={'full_name':'x','role':'SUPER_ADMIN'}); check('profile cannot change role',r.status_code==400)
cookie_before=guest.s.cookies.get('bludhaven_refresh',path='/api/auth/')
r=guest.req('post','/api/auth/change-password/',json={'current_password':'wrong-one-1','new_password':'Another-pass-1357!'}); check('wrong current password refused',r.status_code==400 and 'current_password' in r.json()['error']['details'])
r=guest.req('post','/api/auth/change-password/',json={'current_password':PW,'new_password':PW}); check('same password refused',r.status_code==400)
r=guest.req('post','/api/auth/change-password/',json={'current_password':PW,'new_password':'Another-pass-1357!'}); check('password changed',r.status_code==200, r.text)
c2=requests.Session(); c2.cookies.set('bludhaven_refresh',cookie_before,path='/api/auth/')
t=c2.get(API+'/api/auth/csrf/',headers={'Origin':ORIGIN}).json()['csrfToken']
r=c2.post(API+'/api/auth/token/refresh/',headers={'Origin':ORIGIN,'X-CSRFToken':t}); check('old refresh token revoked after password change',r.status_code==401)
check('old password no longer works',Client().login(guest_email,PW).status_code==401)
g2=Client(); check('new password works',g2.login(guest_email,'Another-pass-1357!').status_code==200)
r=g2.logout(); check('logout (blacklist) 200',r.status_code==200)
r=g2.refresh(); check('refresh after logout rejected',r.status_code==401)

# --- Throttles: refresh has its own bucket
t=Client(); n429=None
for i in range(40):
    r=t.req('post','/api/auth/token/refresh/')
    if r.status_code==429: n429=i+1; break
check(f'refresh throttled on its own bucket (after {n429} calls)',n429 is not None and n429>10)
check('login bucket untouched by refresh traffic',Client().login('demo-guest@demo.bludhaven.test',PW).status_code==200)

bad=[n for n,ok in results if not ok]
print(f'\n{len(results)-len(bad)}/{len(results)} passed'); print('FAILED:',bad)
