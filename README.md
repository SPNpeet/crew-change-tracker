# Crew Change Tracker

ระบบติดตามงานเปลี่ยนลูกเรือของ บริษัท ซัคเซส มารีน เซอร์วิส จำกัด ตามใบเสนอราคา QT-2569-0921-01
เดินตามกระบวนการ 9 ขั้นตอนของบริษัท · สำนักงานใช้บนคอมพิวเตอร์ · พนักงานภาคสนามใช้บนมือถือ · Owner ดูผ่านลิงก์

คู่มือผู้ใช้: [docs/manual.html](docs/manual.html) (PDF: `docs/คู่มือการใช้งาน-CrewChangeTracker.pdf`)

## โครงสร้าง

| ส่วน | ที่อยู่ | หน้าที่ |
|---|---|---|
| Worker (API) | `src/index.js` | เส้นทาง API ทั้งหมด งาน ลูกเรือ จุดเวลา รูป ลิงก์ Owner Excel สำรองข้อมูล |
| สิทธิ์และการเข้าระบบ | `src/auth.js` | รหัสผ่าน PBKDF2-SHA256 · session cookie HttpOnly 60 วัน · ล็อก 15 นาทีเมื่อผิด 8 ครั้ง |
| ค่าเริ่มต้น | `src/settings.js` | จุดสถานะ เอกสาร เรื่องที่ได้รับแต่งตั้ง เวลาถือว่าช้า จำนวนบัญชีสูงสุด 15 |
| Excel | `src/xlsx.js` | สร้างไฟล์ .xlsx โดยไม่ใช้ไลบรารีภายนอก |
| ฐานข้อมูล | `migrations/` | Cloudflare D1 (SQLite) |
| หน้าเว็บ | `public/` | HTML + JavaScript โมดูล ไม่มีขั้นตอน build · ติดตั้งเป็นไอคอนบนมือถือได้ (`manifest.webmanifest`, `sw.js`) |
| ตรรกะเวลา / อีเมล | `public/js/core.js` | สถานะช้า / ตามแผน การเลื่อนเวลาคาดการณ์ ร่างอีเมลทุกแบบ (เวลาไทย UTC+7 ทุกที่) |

บริการที่ใช้: Cloudflare Workers (แผน Paid $5/เดือน) · D1 (ย้อนหลังได้ 30 วันด้วย Time Travel) · R2 (รูปถ่าย และไฟล์สำรองรายเดือน)

## รันบนเครื่อง

```bash
npm install
```

```bash
npx wrangler d1 migrations apply cct --local
```

สร้างไฟล์ `.dev.vars` (ไม่ขึ้น git) ใส่ `SETUP_KEY=รหัสติดตั้งสำหรับเครื่องนี้` แล้ว

```bash
npm run dev
```

เปิด http://127.0.0.1:8787 ครั้งแรกระบบพาไปหน้า "ติดตั้งระบบครั้งแรก" ให้สร้างบัญชีผู้ดูแลระบบด้วย SETUP_KEY

ข้อมูลทดสอบ (ใช้กับเครื่องตัวเองเท่านั้น สคริปต์ปฏิเสธถ้าไม่ใช่ localhost):

```bash
ADMIN_PASS=รหัสผู้ดูแล node scripts/seed-local.mjs
```

## ทดสอบ

```bash
npm test
```

รัน Worker จริงบนพอร์ต 8931 แล้วทดสอบ 16 ชุด: การติดตั้งครั้งแรก การกันคำขอข้ามเว็บ (CSRF) จำนวนบัญชีสูงสุด การล็อกบัญชี สิทธิ์แต่ละบทบาท 9 ขั้นตอน การยืนยันจุดตามลำดับและการส่งซ้ำตอนไม่มีสัญญาณ รูป ลิงก์ Owner ไม่มีข้อมูลส่วนตัว Excel การปิดงาน สำรองข้อมูลทุกคืนและรายเดือน การกู้ข้อมูลจากไฟล์สำรองลงฐานข้อมูลเปล่าแล้วเทียบว่าตรงกันทุกแถว และการเปลี่ยนรหัสผ่าน

## ติดตั้งขึ้นระบบจริง (ทำครั้งเดียว)

สมัคร Cloudflare ด้วยอีเมลกลางของบริษัท (บัญชีเป็นของบริษัท ผู้ให้บริการได้สิทธิ์ดูแลผ่าน Members) และเปิดแผน Workers Paid

1. เข้าระบบ: `npx wrangler login`
2. สร้างฐานข้อมูล: `npx wrangler d1 create cct` แล้วนำ `database_id` ที่ได้ไปแทน `REPLACE_WITH_D1_DATABASE_ID` ใน `wrangler.jsonc`
3. สร้างที่เก็บไฟล์: `npx wrangler r2 bucket create cct-files`
4. สร้างตาราง: `npm run db:remote`
5. ตั้งรหัสติดตั้ง: `npx wrangler secret put SETUP_KEY` (ใช้ครั้งเดียวตอนสร้างผู้ดูแลคนแรก)
6. ขึ้นระบบ: `npm run deploy`
7. ผูกโดเมน เช่น `crew.ชื่อบริษัท.com` ที่ Cloudflare หน้า Workers & Pages เมนู Settings หัวข้อ Domains & Routes
8. เปิดเว็บ สร้างผู้ดูแลระบบคนแรก แล้วเพิ่มผู้ใช้ รถ โรงแรม ที่หน้า "ตั้งค่าระบบ"

## สำรองและกู้คืนข้อมูล

สำรอง 3 ชั้น ไม่ต้องมีคนกด:

| ชั้น | เก็บที่ | ความถี่ | ใช้ทำอะไร |
|---|---|---|---|
| ฐานข้อมูล D1 Time Travel | Cloudflare | ต่อเนื่อง ย้อนได้ 30 วัน | กู้ทั้งฐานข้อมูลไปจุดเวลาใดก็ได้ |
| `backups/daily/วันที่.json.gz` | R2 → NAS ของบริษัท | ทุกคืน 02:00 เก็บ 35 วัน | กู้ระบบทั้งหมดลงฐานข้อมูลใหม่ (ทดสอบใน `npm test` แล้ว) |
| `backups/ปี-เดือน.xlsx` | R2 → NAS ของบริษัท | ทุกวันที่ 1 | เปิดอ่านด้วย Excel ส่งบัญชี / เก็บเป็นหลักฐาน |

รูปถ่ายทั้งหมดอยู่ใน R2 โฟลเดอร์ `photos/` และถูกดึงไป NAS พร้อมกัน

### ตั้ง NAS ให้ดึงข้อมูลทุกคืน (QNAP TS-431KX ทำครั้งเดียว)

1. Cloudflare หน้า R2 เมนู Manage R2 API Tokens สร้าง token สิทธิ์ **Object Read only** เฉพาะ bucket `cct-files` จด Access Key ID, Secret Access Key และ Account ID
2. QNAP เปิดแอป **Hybrid Backup Sync 3** (ติดตั้งจาก App Center ถ้ายังไม่มี) เพิ่มปลายทางแบบ Cloud: **S3 Compatible**
   - Server / Endpoint: `ACCOUNT_ID.r2.cloudflarestorage.com` · ใช้ HTTPS · Region: `auto`
   - ใส่ Access Key ID และ Secret Access Key จากข้อ 1
3. สร้างงาน **Sync แบบ One-way** จาก bucket `cct-files` มาที่โฟลเดอร์ NAS เช่น `/Backup/CrewChange` ตั้งเวลา **ทุกวัน 03:00** (หลังระบบสร้างไฟล์ 02:00) ปิดตัวเลือกลบไฟล์ปลายทาง เพื่อให้ NAS เก็บของเก่าไว้เกิน 35 วันได้
4. กดรันครั้งแรก ตรวจว่ามีโฟลเดอร์ `backups/daily` และ `photos` บน NAS

token นี้อ่านได้อย่างเดียว ถ้า NAS ถูกเจาะก็แก้หรือลบข้อมูลในระบบไม่ได้ · NAS ไม่ต้องเปิดพอร์ตออกอินเทอร์เน็ต เพราะ NAS เป็นฝ่ายดึงออกไปเอง

### กู้คืน

กู้ฐานข้อมูลย้อนเวลา (ภายใน 30 วัน):

```bash
npx wrangler d1 time-travel info cct
```

```bash
npx wrangler d1 time-travel restore cct --timestamp=2026-10-01T09:00:00+07:00
```

กู้จากไฟล์สำรองทุกคืน (เช่น ย้ายไปบัญชี Cloudflare ใหม่ หรือกู้จากไฟล์บน NAS):

```bash
node scripts/backup-to-sql.mjs 2026-10-01.json.gz restore.sql
```

```bash
npx wrangler d1 execute cct --remote --file restore.sql
```

รูปถ่ายกู้ด้วยการอัปโหลดโฟลเดอร์ `photos/` จาก NAS กลับเข้า bucket `cct-files` ชื่อไฟล์เดิม (เช่นใช้ HBS3 sync ย้อนทาง หรือ `rclone copy`)

## ความปลอดภัยและข้อมูลส่วนบุคคล

- repo นี้เป็น public: ห้ามใส่ข้อมูลลูกเรือจริง รหัสผ่าน โทเคน หรือไฟล์ `.dev.vars` ใน repo เด็ดขาด ค่าลับทั้งหมดตั้งด้วย `wrangler secret put` เท่านั้น
- ลิงก์ Owner แสดงเฉพาะชื่อ ตำแหน่ง เที่ยวบิน และเวลา ไม่มีเลขพาสปอร์ต หมายเหตุ รูป หรือข้อมูลพนักงาน
- พนักงานภาคสนามเห็นเฉพาะลูกเรือที่ได้รับมอบหมาย และไม่เห็นเลขบัตรของพนักงานคนอื่น
- ทุกคำขอที่แก้ข้อมูลต้องมาจากหน้าระบบเอง (ตรวจ Origin และ header `x-cct`) · หน้าเว็บใช้ Content-Security-Policy ใน `public/_headers`
