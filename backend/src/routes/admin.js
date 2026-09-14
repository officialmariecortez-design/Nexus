const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db/pool');

const router = express.Router();

function issueAdminToken(admin) {
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET is not configured');
  }

  return jwt.sign(
    {
      sub: 'admin',
      email: admin.email,
      role: 'admin'
    },
    process.env.JWT_SECRET,
    {
      expiresIn: '8h'
    }
  );
}

function adminAuth(req, res, next) {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ')
    ? header.slice(7)
    : '';

  if (!token || !process.env.JWT_SECRET) {
    return res.status(401).json({
      error: 'Admin authentication required'
    });
  }

  try {
    const payload = jwt.verify(
      token,
      process.env.JWT_SECRET
    );

    if (payload.role !== 'admin') {
      return res.status(403).json({
        error: 'Admin access required'
      });
    }

    req.admin = payload;
    next();
  } catch {
    return res.status(401).json({
      error: 'Invalid or expired admin session'
    });
  }
}


/* =========================
   ADMIN LOGIN
========================= */

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};

  const adminEmail = String(
    process.env.ADMIN_EMAIL || ''
  ).trim().toLowerCase();

  const adminPassword =
    process.env.ADMIN_PASSWORD || '';

  if (!adminEmail || !adminPassword) {
    return res.status(503).json({
      error:
        'Admin credentials are not configured. Add ADMIN_EMAIL and ADMIN_PASSWORD in Vercel.'
    });
  }

  if (!email || !password) {
    return res.status(400).json({
      error: 'Email and password are required'
    });
  }

  if (
    String(email).trim().toLowerCase() !== adminEmail ||
    String(password) !== adminPassword
  ) {
    return res.status(401).json({
      error: 'Invalid admin credentials'
    });
  }

  res.json({
    token: issueAdminToken({
      email: adminEmail
    }),
    admin: {
      email: adminEmail,
      role: 'admin'
    }
  });
});


router.get('/me', adminAuth, (_req, res) => {
  res.json({
    admin: {
      email: process.env.ADMIN_EMAIL,
      role: 'admin'
    }
  });
});


/* =========================
   ADMIN STATS
========================= */

router.get('/stats', adminAuth, async (_req, res) => {
  try {
    const [users, accounts, kyc] =
      await Promise.all([
        pool.query(
          'SELECT COUNT(*)::int AS count FROM users'
        ),

        pool.query(
          'SELECT COUNT(*)::int AS count FROM accounts'
        ),

        pool.query(`
          SELECT status, COUNT(*)::int AS count
          FROM kyc_profiles
          GROUP BY status
        `)
      ]);

    const kycCounts = Object.fromEntries(
      kyc.rows.map(row => [
        row.status,
        row.count
      ])
    );

    res.json({
      users: users.rows[0].count,
      accounts: accounts.rows[0].count,
      kyc: kycCounts
    });

  } catch (error) {
    console.error(
      'Admin stats error:',
      error
    );

    res.status(500).json({
      error: 'Unable to load admin statistics'
    });
  }
});


/* =========================
   USERS
========================= */

router.get('/users', adminAuth, async (_req, res) => {
  try {

    await pool.query(`
      ALTER TABLE public.users
      ADD COLUMN IF NOT EXISTS tier
      VARCHAR(20)
      NOT NULL
      DEFAULT 'standard'
    `);

    const result = await pool.query(`
      SELECT
        u.id,
        u.username,
        u.full_name,
        u.email,
        u.phone,
        u.created_at,
        COALESCE(u.tier, 'standard') AS tier,
        a.account_number,
        a.status AS account_status,
        k.status AS kyc_status
      FROM users u
      LEFT JOIN accounts a
        ON a.user_id = u.id
      LEFT JOIN kyc_profiles k
        ON k.user_id = u.id
      ORDER BY u.created_at DESC
      LIMIT 200
    `);

    res.json({
      users: result.rows
    });

  } catch (error) {

    console.error(
      'Admin users error:',
      error
    );

    res.status(500).json({
      error: 'Unable to load users'
    });


/* =========================
   KYC LIST
========================= */

router.get('/kyc', adminAuth, async (_req, res) => {
  try {

    const result = await pool.query(`
      SELECT
        k.id,
        k.user_id,
        k.legal_name,
        k.date_of_birth,
        k.country,
        k.city,
        k.id_type,
        k.status,
        k.review_note,
        k.submitted_at,
        k.reviewed_at,
        u.email,
        u.username
      FROM kyc_profiles k
      JOIN users u
        ON u.id = k.user_id
      ORDER BY k.submitted_at DESC
      LIMIT 200
    `);

    res.json({
      kyc: result.rows
    });

  } catch (error) {

    console.error(
      'Admin KYC error:',
      error
    );

    res.status(500).json({
      error: 'Unable to load KYC records'
    });
  };


/* =========================
   UPDATE KYC STATUS
========================= */

async function updateKycStatus(req, res) {

  const id = Number.parseInt(
    req.params.id,
    10
  );

  const status = String(
    req.body?.status || ''
  )
    .trim()
    .toLowerCase();

  const reviewNote =
    req.body?.review_note == null
      ? null
      : String(
          req.body.review_note
        )
          .trim()
          .slice(0, 2000);

  if (
    !Number.isInteger(id) ||
    id < 1
  ) {
    return res.status(400).json({
      error: 'Invalid KYC record ID'
    });
  }

  if (
    ![
      'pending',
      'approved',
      'rejected'
    ].includes(status)
  ) {
    return res.status(400).json({
      error: 'Invalid KYC status'
    });
  }

  let client;

  try {

    client = await pool.connect();

    await client.query('BEGIN');

    /*
      Make sure customer tier exists.
    */
    await client.query(`
      ALTER TABLE public.users
      ADD COLUMN IF NOT EXISTS tier
      VARCHAR(20)
      NOT NULL
      DEFAULT 'standard'
    `);


    /*
      Find KYC record and customer.
    */
    const kycResult =
      await client.query(
        `
        SELECT
          id,
          user_id
        FROM public.kyc_profiles
        WHERE id = $1
        FOR UPDATE
        `,
        [id]
      );


    if (kycResult.rowCount === 0) {

      await client.query(
        'ROLLBACK'
      );

      return res.status(404).json({
        error: 'KYC record not found'
      });
    }


    const userId =
      kycResult.rows[0].user_id;


    /*
      Update KYC record.
    */
    const result =
      await client.query(
        `
        UPDATE public.kyc_profiles
        SET
          status = $1,
          review_note = $2,

          reviewed_at =
            CASE
              WHEN $1 = 'pending'
                THEN NULL
              ELSE NOW()
            END,

          reviewed_by =
            CASE
              WHEN $1 = 'pending'
                THEN NULL
              ELSE $3
            END

        WHERE id = $4

        RETURNING
          id,
          user_id,
          status,
          review_note,
          submitted_at,
          reviewed_at,
          reviewed_by
        `,
        [
          status,
          reviewNote,
          req.admin.email,
          id
        ]
      );


    /*
      Approved KYC unlocks
      verified customer tier.
    */
    if (status === 'approved') {

      await client.query(
        `
        UPDATE public.users
        SET tier = 'verified'
        WHERE id = $1
        `,
        [userId]
      );
    }


    await client.query(
      'COMMIT'
    );


    return res.json({
      success: true,

      message:
        status === 'approved'
          ? 'Customer KYC approved successfully and trading access unlocked'
          : status === 'rejected'
            ? 'Customer KYC rejected'
            : 'Customer KYC returned to pending',

      kyc: result.rows[0]
    });


  } catch (error) {

    if (client) {
      await client
        .query('ROLLBACK')
        .catch(() => {});
    }

    console.error(
      'Admin KYC update error:',
      error
    );

    return res.status(500).json({
      error: 'Unable to update KYC record',
      code: error.code || null,
      detail: error.detail || null,
      constraint:
        error.constraint || null,
      message:
        error.message || null
    });

  } finally {

    if (client) {
      client.release();
    }
  }
}


router.post(
  '/kyc/:id/status',
  adminAuth,
  updateKycStatus
);

router.patch(
  '/kyc/:id',
  adminAuth,
  updateKycStatus
);


/* =========================
   PORTFOLIO CONTROLS
========================= */

router.get(
  '/portfolio/:userId',
  adminAuth,
  async (req, res) => {

    const userId =
      Number.parseInt(
        req.params.userId,
        10
      );

    if (
      !Number.isInteger(userId) ||
      userId < 1
    ) {
      return res.status(400).json({
        error: 'Invalid user ID'
      });
    }

    try {

      await pool.query(`
        ALTER TABLE accounts
        ADD COLUMN IF NOT EXISTS
        admin_adjusted_pnl
        NUMERIC(30,10)
        NOT NULL
        DEFAULT 0
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS
        portfolio_adjustments (

          id BIGSERIAL PRIMARY KEY,

          account_id BIGINT NOT NULL
            REFERENCES accounts(id)
            ON DELETE CASCADE,

          adjustment_type
            VARCHAR(30)
            NOT NULL
            CHECK (
              adjustment_type
              IN ('cash', 'profit_loss')
            ),

          amount
            NUMERIC(30,10)
            NOT NULL,

          note TEXT,

          created_by
            VARCHAR(255)
            NOT NULL,

          created_at
            TIMESTAMPTZ
            NOT NULL
            DEFAULT NOW()
        )
      `);

      const result =
        await pool.query(
          `
          SELECT
            u.id,
            u.email,
            u.full_name,
            u.username,

            a.id AS account_id,
            a.account_number,
            a.cash_balance,
            a.realized_pnl,
            a.admin_adjusted_pnl,
            a.status

          FROM users u

          JOIN accounts a
            ON a.user_id = u.id

          WHERE u.id = $1

          ORDER BY a.id

          LIMIT 1
          `,
          [userId]
        );


      if (!result.rowCount) {
        return res.status(404).json({
          error:
            'Customer account not found'
        });
      }


      const adjustments =
        await pool.query(
          `
          SELECT
            id,
            adjustment_type,
            amount,
            note,
            created_by,
            created_at

          FROM portfolio_adjustments

          WHERE account_id = $1

          ORDER BY created_at DESC

          LIMIT 100
          `,
          [result.rows[0].account_id]
        );


      res.json({
        account: result.rows[0],
        adjustments:
          adjustments.rows
      });

    } catch (error) {

      console.error(
        'Portfolio control load:',
        error
      );

      res.status(500).json({
        error:
          'Unable to load portfolio controls'
      });
    }
  }
);


/* =========================
   PORTFOLIO ADJUSTMENT
========================= */

router.post(
  '/portfolio/:userId/adjust',
  adminAuth,
  async (req, res) => {

    const userId =
      Number.parseInt(
        req.params.userId,
        10
      );

    const type =
      String(
        req.body?.adjustment_type || ''
      ).trim();

    const amount =
      Number(req.body?.amount);

    const note =
      String(
        req.body?.note || ''
      )
        .trim()
        .slice(0, 500);


    if (
      !Number.isInteger(userId) ||
      userId < 1
    ) {
      return res.status(400).json({
        error: 'Invalid user ID'
      });
    }


    if (
      ![
        'cash',
        'profit_loss'
      ].includes(type)
    ) {
      return res.status(400).json({
        error:
          'Adjustment type must be cash or profit_loss'
      });
    }


    if (
      !Number.isFinite(amount) ||
      amount === 0
    ) {
      return res.status(400).json({
        error:
          'Enter a non-zero adjustment amount'
      });
    }


    if (!note) {
      return res.status(400).json({
        error:
          'A reason is required for every portfolio adjustment'
      });
    }


    let client;

    try {

      client =
        await pool.connect();

      await client.query(
        'BEGIN'
      );


      await client.query(`
        ALTER TABLE accounts
        ADD COLUMN IF NOT EXISTS
        admin_adjusted_pnl
        NUMERIC(30,10)
        NOT NULL
        DEFAULT 0
      `);


      await client.query(`
        CREATE TABLE IF NOT EXISTS
        portfolio_adjustments (

          id BIGSERIAL PRIMARY KEY,

          account_id BIGINT NOT NULL
            REFERENCES accounts(id)
            ON DELETE CASCADE,

          adjustment_type
            VARCHAR(30)
            NOT NULL
            CHECK (
              adjustment_type
              IN ('cash', 'profit_loss')
            ),

          amount
            NUMERIC(30,10)
            NOT NULL,

          note TEXT,

          created_by
            VARCHAR(255)
            NOT NULL,

          created_at
            TIMESTAMPTZ
            NOT NULL
            DEFAULT NOW()
        )
      `);


      const accountResult =
        await client.query(
          `
          SELECT
            id,
            cash_balance,
            realized_pnl

          FROM accounts

          WHERE user_id = $1

          ORDER BY id

          LIMIT 1

          FOR UPDATE
          `,
          [userId]
        );


      if (!accountResult.rowCount) {

        throw Object.assign(
          new Error(
            'Customer account not found'
          ),
          {
            status: 404
          }
        );
      }


      const account =
        accountResult.rows[0];


      if (type === 'cash') {

        const next =
          Number(
            account.cash_balance
          ) + amount;


        if (next < 0) {

          throw Object.assign(
            new Error(
              'Cash balance cannot become negative'
            ),
            {
              status: 400
            }
          );
        }


        await client.query(
          `
          UPDATE accounts

          SET
            cash_balance = $1,
            updated_at = NOW()

          WHERE id = $2
          `,
          [
            next,
            account.id
          ]
        );

      } else {

        await client.query(
          `
          UPDATE accounts

          SET
            admin_adjusted_pnl =
              admin_adjusted_pnl + $1,

            updated_at = NOW()

          WHERE id = $2
          `,
          [
            amount,
            account.id
          ]
        );
      }


      const inserted =
        await client.query(
          `
          INSERT INTO
          portfolio_adjustments (
            account_id,
            adjustment_type,
            amount,
            note,
            created_by
          )

          VALUES (
            $1,
            $2,
            $3,
            $4,
            $5
          )

          RETURNING *
          `,
          [
            account.id,
            type,
            amount,
            note,
            req.admin.email
          ]
        );


      await client.query(
        'COMMIT'
      );


      res.json({
        adjustment:
          inserted.rows[0],

        message:
          'Portfolio adjustment recorded and audited.'
      });


    } catch (error) {

      if (client) {
        await client
          .query('ROLLBACK')
          .catch(() => {});
      }

      console.error(
        'Portfolio adjustment:',
        error
      );

      res.status(
        error.status || 500
      ).json({
        error:
          error.message ||
          'Unable to adjust portfolio'
      });

    } finally {

      if (client) {
        client.release();
      }
    }
  }
);


/* =========================
   EXPORT
========================= */

module.exports = {
  router,
  adminAuth
};
