```js
const express = require('express');
const jwt = require('jsonwebtoken');
const pool = require('../db/pool');

const router = express.Router();


/* =========================================================
   ADMIN TOKEN
========================================================= */

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


/* =========================================================
   ADMIN AUTH MIDDLEWARE
========================================================= */

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

  } catch (error) {
    return res.status(401).json({
      error: 'Invalid or expired admin session'
    });
  }
}


/* =========================================================
   ADMIN LOGIN
========================================================= */

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};

    const adminEmail = String(
      process.env.ADMIN_EMAIL || ''
    )
      .trim()
      .toLowerCase();

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
      String(email).trim().toLowerCase() !==
        adminEmail ||
      String(password) !== adminPassword
    ) {
      return res.status(401).json({
        error: 'Invalid admin credentials'
      });
    }

    const token = issueAdminToken({
      email: adminEmail
    });

    return res.json({
      success: true,

      token,

      admin: {
        email: adminEmail,
        role: 'admin'
      }
    });

  } catch (error) {
    console.error(
      'Admin login error:',
      error
    );

    return res.status(500).json({
      error: 'Unable to login as administrator'
    });
  }
});


/* =========================================================
   ADMIN SESSION
========================================================= */

router.get(
  '/me',
  adminAuth,
  (_req, res) => {
    return res.json({
      admin: {
        email: process.env.ADMIN_EMAIL,
        role: 'admin'
      }
    });
  }
);


/* =========================================================
   ADMIN STATS
========================================================= */

router.get(
  '/stats',
  adminAuth,
  async (_req, res) => {

    try {

      const usersResult =
        await pool.query(
          `
          SELECT COUNT(*)::int AS count
          FROM public.users
          `
        );

      const accountsResult =
        await pool.query(
          `
          SELECT COUNT(*)::int AS count
          FROM public.accounts
          `
        );

      const kycResult =
        await pool.query(
          `
          SELECT
            status,
            COUNT(*)::int AS count
          FROM public.kyc_profiles
          GROUP BY status
          `
        );

      const kycCounts =
        Object.fromEntries(
          kycResult.rows.map(row => [
            row.status,
            row.count
          ])
        );

      return res.json({
        users:
          usersResult.rows[0].count,

        accounts:
          accountsResult.rows[0].count,

        kyc:
          kycCounts
      });

    } catch (error) {

      console.error(
        'Admin stats error:',
        error
      );

      return res.status(500).json({
        error:
          'Unable to load admin statistics',

        code:
          error.code || null,

        message:
          error.message || null
      });
    }
  }
);


/* =========================================================
   USERS
========================================================= */

router.get(
  '/users',
  adminAuth,
  async (_req, res) => {

    try {

      /*
        Make sure customer tier exists.
      */

      await pool.query(`
        ALTER TABLE public.users
        ADD COLUMN IF NOT EXISTS
        tier VARCHAR(20)
        NOT NULL
        DEFAULT 'standard'
      `);


      const result =
        await pool.query(
          `
          SELECT
            u.id,
            u.username,
            u.full_name,
            u.email,
            u.phone,
            u.created_at,

            COALESCE(
              u.tier,
              'standard'
            ) AS tier,

            a.account_number,
            a.status AS account_status,

            k.status AS kyc_status

          FROM public.users u

          LEFT JOIN public.accounts a
            ON a.user_id = u.id

          LEFT JOIN public.kyc_profiles k
            ON k.user_id = u.id

          ORDER BY
            u.created_at DESC

          LIMIT 200
          `
        );


      return res.json({
        users: result.rows
      });

    } catch (error) {

      console.error(
        'Admin users error:',
        error
      );

      return res.status(500).json({
        error:
          'Unable to load users',

        code:
          error.code || null,

        message:
          error.message || null
      });
    }
  }
);


/* =========================================================
   KYC LIST
========================================================= */

router.get(
  '/kyc',
  adminAuth,
  async (_req, res) => {

    try {

      const result =
        await pool.query(
          `
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

          FROM public.kyc_profiles k

          JOIN public.users u
            ON u.id = k.user_id

          ORDER BY
            k.submitted_at DESC

          LIMIT 200
          `
        );


      return res.json({
        kyc: result.rows
      });

    } catch (error) {

      console.error(
        'Admin KYC error:',
        error
      );

      return res.status(500).json({
        error:
          'Unable to load KYC records',

        code:
          error.code || null,

        message:
          error.message || null
      });
    }
  }
);


/* =========================================================
   UPDATE KYC STATUS
========================================================= */

async function updateKycStatus(
  req,
  res
) {

  const id =
    Number.parseInt(
      req.params.id,
      10
    );

  const status =
    String(
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


  /* -------------------------------------------------------
     VALIDATE ID
  ------------------------------------------------------- */

  if (
    !Number.isInteger(id) ||
    id < 1
  ) {
    return res.status(400).json({
      error:
        'Invalid KYC record ID'
    });
  }


  /* -------------------------------------------------------
     VALIDATE STATUS
  ------------------------------------------------------- */

  if (
    ![
      'pending',
      'approved',
      'rejected'
    ].includes(status)
  ) {
    return res.status(400).json({
      error:
        'Invalid KYC status'
    });
  }


  let client = null;


  try {

    client =
      await pool.connect();


    await client.query(
      'BEGIN'
    );


    /* -----------------------------------------------------
       MAKE SURE USER TIER EXISTS
    ----------------------------------------------------- */

    await client.query(`
      ALTER TABLE public.users
      ADD COLUMN IF NOT EXISTS
      tier VARCHAR(20)
      NOT NULL
      DEFAULT 'standard'
    `);


    /* -----------------------------------------------------
       FIND KYC RECORD
    ----------------------------------------------------- */

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


    if (
      kycResult.rowCount === 0
    ) {

      await client.query(
        'ROLLBACK'
      );

      return res.status(404).json({
        error:
          'KYC record not found'
      });
    }


    const userId =
      kycResult.rows[0].user_id;


    /* -----------------------------------------------------
       UPDATE KYC
    ----------------------------------------------------- */

    const updatedKyc =
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


    /* -----------------------------------------------------
       APPROVED KYC
       UNLOCKS VERIFIED TIER
    ----------------------------------------------------- */

    if (
      status === 'approved'
    ) {

      await client.query(
        `
        UPDATE public.users

        SET
          tier = 'verified'

        WHERE id = $1
        `,
        [userId]
      );
    }


    /* -----------------------------------------------------
       REJECTED / PENDING
       RETURN CUSTOMER TO STANDARD
       ONLY IF DESIRED
    ----------------------------------------------------- */

    if (
      status === 'rejected' ||
      status === 'pending'
    ) {

      await client.query(
        `
        UPDATE public.users

        SET
          tier = 'standard'

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

      kyc:
        updatedKyc.rows[0]
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

      error:
        'Unable to update KYC record',

      code:
        error.code || null,

      detail:
        error.detail || null,

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


/* =========================================================
   KYC APPROVAL ENDPOINT
========================================================= */

router.post(
  '/kyc/:id/status',
  adminAuth,
  updateKycStatus
);


/* =========================================================
   KYC UPDATE ENDPOINT
========================================================= */

router.patch(
  '/kyc/:id',
  adminAuth,
  updateKycStatus
);


/* =========================================================
   EXPORT
========================================================= */

module.exports = {
  router,
  adminAuth
};
```
