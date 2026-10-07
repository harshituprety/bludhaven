import re, time, uuid, datetime, urllib.parse, requests
from playwright.sync_api import sync_playwright
B='http://localhost:5173'; API='http://localhost:8000'; LOG='/tmp/claude-0/smoke/server.log'; PW='Demo-pass-12345!'
H={'Origin':'http://localhost:5173'}
res=[]
def check(n,c,x=''): res.append((n,bool(c))); print(('PASS' if c else 'FAIL'),n,'' if c else x)
today=datetime.date.today(); d=lambda n:(today+datetime.timedelta(days=n)).isoformat()
tag=uuid.uuid4().hex[:6]; email=f'ui-guest-{tag}@example.com'
# prepare: host property id and a blocker booking from demo-guest
t=requests.post(API+'/api/auth/token/',json={'email':'demo-guest@demo.bludhaven.test','password':PW},headers=H).json()['access']
props=requests.get(API+'/api/properties/?search=Smoke Cabin&ordering=-created_at').json()['results']
pid=props[0]['id']; print('property',pid,props[0]['title'])
r=requests.post(API+'/api/bookings/',json={'property':pid,'check_in':d(30),'check_out':d(33),'guests_count':1},headers={**H,'Authorization':'Bearer '+t}); print('blocker',r.status_code)
def link(pat,since):
    for _ in range(30):
        m=re.findall(pat,open(LOG,errors='ignore').read()[since:])
        if m: return urllib.parse.unquote(m[-1])
        time.sleep(.3)
with sync_playwright() as p:
    br=p.chromium.launch(); errs=[]
    ctx=br.new_context(viewport={'width':1280,'height':1000}); pg=ctx.new_page()
    pg.on('pageerror',lambda e:errs.append('pageerror '+str(e)))
    pg.on('response',lambda r: errs.append(f'{r.status} {r.request.method} {r.url}') if r.status>=400 and '/api/' in r.url else None)
    # --- register via UI
    mark=len(open(LOG,errors='ignore').read())
    pg.goto(B+'/register'); pg.get_by_label('Full name').fill('UI Guest'); pg.get_by_label(re.compile('^Email')).fill(email)
    pg.get_by_placeholder(re.compile('at least 8',re.I)).fill(PW); pg.get_by_role('checkbox').check(); pg.get_by_role('button',name='Create account').click()
    pg.wait_for_selector('text=Check your email',timeout=10000); check('UI register -> check your email',True)
    tok=link(r'verify-email\?token=([^\s"<&]+)',mark)
    pg.goto(B+'/verify-email?token='+urllib.parse.quote(tok)); pg.wait_for_timeout(2500)
    check('UI verify-email success',pg.get_by_text(re.compile('verified',re.I)).count()>0 and '?token' not in pg.url, pg.inner_text('body')[:200])
    # --- login
    pg.goto(B+'/login'); pg.get_by_label('Email').fill(email); pg.get_by_placeholder('Your password').fill(PW); pg.get_by_role('button',name='Log in').click()
    pg.wait_for_url(re.compile(r'/(trips|account)?$'),timeout=10000); pg.wait_for_timeout(1000)
    check('UI login -> user menu',pg.get_by_role('button',name=re.compile('UI Guest')).count()>0)
    check('no tokens in web storage',not any(re.search(r'eyJ',v or '') for v in pg.evaluate('Object.values(localStorage).concat(Object.values(sessionStorage))')))
    pg.reload(); pg.wait_for_timeout(2500)
    check('UI session restored after reload',pg.get_by_role('button',name=re.compile('UI Guest')).count()>0)
    # --- browse + filter
    pg.goto(B+'/properties'); pg.wait_for_selector('a[href^="/properties/"]',timeout=15000)
    n=pg.locator('a[href^="/properties/"]').count(); check('UI listings from API',n>0)
    pg.goto(B+'/properties?destination=Smoke'); pg.wait_for_timeout(2000)
    check('UI search narrows results',pg.locator('a[href^="/properties/"]').count()>=1 and pg.locator('a[href^="/properties/"]').count()<n)
    # favourite on search results
    pg.get_by_role('button',name=re.compile('save|favourite',re.I)).first.click(); pg.wait_for_timeout(1000)
    pg.goto(B+'/favourites'); pg.wait_for_timeout(2000); check('UI favourite persisted',pg.locator(f'a[href="/properties/{pid}"]').count()>=1)
    # --- detail + availability
    pg.goto(B+f'/properties/{pid}'); pg.wait_for_timeout(2000)
    pg.get_by_role('button',name=re.compile('check-in',re.I)).first.click(); pg.wait_for_timeout(500)
    # advance months until the blocked date is rendered
    cell=None
    for _ in range(3):
        if pg.locator(f'[data-date="{d(31)}"]').count(): break
        pg.get_by_role('button',name='Next month').first.click(); pg.wait_for_timeout(300)
    cell=pg.locator(f'[data-date="{d(31)}"]').first
    check('UI calendar marks booked day unavailable',cell.get_attribute('aria-disabled')=='true' or cell.is_disabled(), cell.evaluate('e=>e.outerHTML')[:200])
    pg.screenshot(path='/tmp/claude-0/e2e/calendar.png')
    # pick free dates d(40)..d(42)
    for dd in (d(60),d(62)):
        for _ in range(3):
            if pg.locator(f'[data-date="{dd}"]').count(): break
            pg.get_by_role('button',name='Next month').first.click(); pg.wait_for_timeout(300)
        pg.locator(f'[data-date="{dd}"]').first.click(); pg.wait_for_timeout(300)
    pg.wait_for_timeout(500)
    pg.get_by_role('button',name=re.compile(r'^(Book|Request)',re.I)).first.click(); pg.wait_for_timeout(2500)
    body=pg.inner_text('body')
    check('UI booking created, backend total shown',re.search(r'4,000|4000',body) and re.search('pending|requested',body,re.I), body[-400:])
    pg.screenshot(path='/tmp/claude-0/e2e/booked.png')
    pg.goto(B+'/trips'); pg.wait_for_timeout(2000); check('UI my trips lists booking',pg.get_by_text(re.compile('pending',re.I)).count()>0)
    # --- profile + password change in UI
    pg.goto(B+'/account'); pg.wait_for_timeout(1500)
    pg.get_by_label(re.compile('full name|name',re.I)).first.fill('UI Guest Two'); pg.get_by_role('button',name=re.compile('save',re.I)).first.click(); pg.wait_for_timeout(1200)
    check('UI profile saved',pg.get_by_text(re.compile('saved|updated',re.I)).count()>0)
    newpw='Brand-new-pass-4321!'
    pg.get_by_label(re.compile('current password',re.I)).fill(PW)
    pg.get_by_label(re.compile('^new password',re.I)).fill(newpw)
    pg.get_by_label(re.compile('confirm',re.I)).fill(newpw)
    pg.get_by_role('button',name=re.compile('change password',re.I)).click()
    pg.wait_for_url(re.compile('/login'),timeout=8000); pg.wait_for_selector('text=password was changed',timeout=5000); check('UI change password -> login with notice',pg.get_by_text(re.compile('password was changed',re.I)).count()>0)
    pg.get_by_label('Email').fill(email); pg.get_by_placeholder('Your password').fill(newpw); pg.get_by_role('button',name='Log in').click(); pg.wait_for_timeout(2500)
    check('UI login with new password',pg.get_by_role('button',name=re.compile('UI Guest')).count()>0)
    pg.get_by_role('button',name=re.compile('UI Guest')).click(); pg.get_by_role('menuitem',name=re.compile('log out',re.I)).click(); pg.wait_for_timeout(1500)
    check('UI logout',pg.get_by_role('link',name=re.compile('log in',re.I)).count()>0)
    ctx.close()
    # --- host in UI: confirm booking
    ctx=br.new_context(viewport={'width':1280,'height':1000}); pg=ctx.new_page()
    pg.on('response',lambda r: errs.append(f'{r.status} {r.request.method} {r.url}') if r.status>=400 and '/api/' in r.url else None)
    host_email=[x for x in requests.get(API+f'/api/properties/{pid}/').json()['owner'].items()]
    # host credentials: the smoke host from the API run
    import subprocess
    he=subprocess.run(['bash','-lc',"cd /home/claude/proj/bludhaven/backend && source .venv/bin/activate && python manage.py shell -c \"from apps.catalog.models import Property; print(Property.objects.get(pk=%d).owner.email)\""%pid],capture_output=True,text=True).stdout.strip().splitlines()[-1]
    pg.goto(B+'/login'); pg.get_by_label('Email').fill(he); pg.get_by_placeholder('Your password').fill('Host-pass-67890!'); pg.get_by_role('button',name='Log in').click()
    pg.wait_for_url(re.compile('/host'),timeout=10000)
    pg.goto(B+'/host/bookings'); pg.wait_for_timeout(2000)
    conf=pg.get_by_role('button',name=re.compile('^confirm',re.I))
    check('UI host sees pending booking with Confirm',conf.count()>0)
    if conf.count(): 
        conf.first.click(); pg.wait_for_timeout(800)
        d2=pg.get_by_role('button',name=re.compile('confirm',re.I))
        if pg.locator('dialog[open]').count(): pg.locator('dialog[open]').get_by_role('button',name=re.compile('confirm',re.I)).click()
        pg.wait_for_timeout(1500)
        check('UI host confirmed booking',pg.get_by_text(re.compile('confirmed',re.I)).count()>0)
    pg.goto(B+'/host/subscription'); pg.wait_for_timeout(2000)
    check('UI host subscription page shows plan limits',pg.get_by_text(re.compile('Smoke plan')).count()>0 and pg.get_by_text(re.compile('max|propert',re.I)).count()>0)
    pg.goto(B+f'/host/properties/{pid}/edit'); pg.wait_for_timeout(2500)
    pg.set_input_files('input[type=file]',{'name':'x.txt','mimeType':'text/plain','buffer':b'hello'}); pg.wait_for_timeout(1500)
    check('UI image upload error shown for non-image',pg.get_by_text(re.compile('JPEG|PNG|WebP|not.*image|supported',re.I)).count()>0, pg.inner_text('main')[-300:])
    ctx.close()
    # --- admin
    ctx=br.new_context(viewport={'width':1280,'height':1000}); pg=ctx.new_page()
    pg.on('response',lambda r: errs.append(f'{r.status} {r.request.method} {r.url}') if r.status>=400 and '/api/' in r.url else None)
    pg.goto(B+'/login'); pg.get_by_label('Email').fill('demo-admin@demo.bludhaven.test'); pg.get_by_placeholder('Your password').fill(PW); pg.get_by_role('button',name='Log in').click()
    pg.wait_for_url(re.compile('/admin'),timeout=10000)
    for path in ('','/users','/properties','/bookings','/destinations','/plans','/subscriptions'):
        pg.goto(B+'/admin'+path); pg.wait_for_timeout(1200); check('UI admin'+(path or '/')+' loads',pg.get_by_text('Something went wrong').count()==0)
    pg.goto(B+f'/admin/properties/{pid}/edit'); pg.wait_for_timeout(2000)
    check('UI admin can open any property editor',pg.get_by_label('Title').count()>0 and pg.get_by_label('Title').input_value().startswith('Smoke Cabin'))
    ctx.close(); br.close()
print('API errors seen (>=400):'); [print('  ',e) for e in sorted(set(errs))[:20]]
bad=[n for n,ok in res if not ok]; print(f'{len(res)-len(bad)}/{len(res)} passed; failed={bad}')
