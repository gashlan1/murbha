require('dotenv').config();
const { pool } = require('./pool');
const { hashPassword } = require('../lib/auth');

const PROJECTS = [
  ['aircraft-cleaning','عقد تنظيف وتجهيز الطائرات — مطار جدة','تشغيل وصيانة','جدة',4000000,1200000,5000,0.115,12,'open'],
  ['riyadh-mall-expansion','توسعة مجمّع تجاري — الرياض','عقاري تجاري','الرياض',5000000,3250000,1000,0.094,18,'open'],
  ['jeddah-logistics-fleet','أسطول لوجستي — جدة','نقل ولوجستيات','جدة',3000000,1820000,1000,0.108,24,'open'],
  ['eastern-solar-farm','محطة طاقة شمسية — المنطقة الشرقية','طاقة متجددة','الدمام',8000000,6400000,5000,0.085,36,'open'],
  ['makkah-residential-tower','برج سكني — مكة المكرّمة','عقاري سكني','مكة المكرّمة',12000000,9600000,2000,0.115,24,'open'],
  ['neom-supplier-financing','تمويل مورّد — نيوم','تمويل تجاري','نيوم',1500000,1500000,1000,0.092,6,'funded'],
  ['alangary-om-1','تشغيل وصيانة مجمع المعذر السكني — الرياض','تشغيل وصيانة (O&M)','الرياض',4000000,4000000,1000,0.112,12,'completed'],
  ['alangary-om-2','تشغيل وصيانة شبكة مياه مجمع الصناعات — الجبيل','تشغيل وصيانة (O&M)','الجبيل',2500000,2500000,1000,0.098,18,'completed'],
  ['alangary-om-3','صيانة أنظمة التكييف المركزي لفنادق الحمراء — جدة','تشغيل وصيانة (O&M)','جدة',3200000,3200000,1000,0.105,12,'completed'],
  ['alangary-om-4','تشغيل وصيانة المحطة الفرعية للكهرباء — المدينة المنورة','تشغيل وصيانة (O&M)','المدينة المنورة',5500000,5500000,1000,0.118,12,'completed'],
  ['alangary-om-5','صيانة الأنظمة الميكانيكية لمستشفى دار السلام — الدمام','تشغيل وصيانة (O&M)','الدمام',4800000,4800000,1000,0.102,24,'completed'],
];

async function seed() {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('TRUNCATE investments, transactions, notifications RESTART IDENTITY CASCADE');
    await c.query('DELETE FROM projects');
    for (const [slug, name, category, city, goal, raised, min, rate, term, status] of PROJECTS) {
      await c.query(
        `INSERT INTO projects (slug,name,category,city,goal,raised,min_amount,profit_rate,term_months,status,total_value)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$5)`,
        [slug, name, category, city, goal, raised, min, rate, term, status]
      );
    }
    // Upsert an admin user (idempotent). Promote to admin if already present.
    const adminRow = await c.query("SELECT id FROM users WHERE username = 'admin'");
    if (adminRow.rowCount === 0) {
      const adminHash = await hashPassword('admin12345');
      await c.query(
        `INSERT INTO users (username, password_hash, full_name, role, approved)
         VALUES ('admin', $1, 'مدير المنصة', 'admin', true)`,
        [adminHash]
      );
    } else {
      await c.query("UPDATE users SET role = 'admin', approved = true WHERE id = $1", [adminRow.rows[0].id]);
    }

    const u = await c.query("SELECT id FROM users WHERE username = 'demo'");
    if (u.rowCount > 0) {
      const uid = u.rows[0].id;
      await c.query('UPDATE users SET balance = 50000 WHERE id = $1', [uid]);
      await c.query(
        `INSERT INTO transactions (user_id,kind,amount,description) VALUES ($1,'deposit',50000,'إيداع افتتاحي عبر مدى')`, [uid]);
      await c.query(
        `INSERT INTO notifications (user_id,title,body,type) VALUES ($1,'أهلاً بك في مُرابحة','تم إيداع رصيدك الافتتاحي. تصفّح الفرص وابدأ الاستثمار.','welcome')`, [uid]);
    }
    await c.query('COMMIT');
    console.log(`[seed] ${PROJECTS.length} projects inserted`);
  } catch (e) {
    await c.query('ROLLBACK'); throw e;
  } finally {
    c.release(); await pool.end();
  }
}

seed().catch(err => { console.error('[seed] failed:', err.message); process.exit(1); });
