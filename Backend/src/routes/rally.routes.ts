import { Router } from "express";
import { pool } from "../db/pool.js";
import { authenticateToken } from "../middleware/auth.middleware.js";

const rallyRouter = Router();

//creating rally and assigning owner
rallyRouter.post("/", authenticateToken, async (req, res) => {
  const { title, description } = req.body;

  const createdByUserId = res.locals.userId;

  if (
    typeof title !== "string" ||
    !title.trim() ||
    typeof createdByUserId !== "string"
  ) {
    return res.status(400).json({
      status: "error",
      message: "Title and createdByUserId are required",
    });
  }

  if (
    description !== undefined &&
    description !== null &&
    typeof description !== "string"
  ) {
    return res.status(400).json({
      status: "error",
      message: "Description must be a string",
    });
  }

  //we got a server connection
  const client = await pool.connect();

  try {
    //we're telling the pool(postgres) to begin and from here we'll -perform more operations , untile i release
    await client.query("BEGIN");

    //creating a rally
    const rallyResult = await client.query(
      `INSERT INTO rallies (title, description, created_by)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [title.trim(), description?.trim() || null, createdByUserId],
    );

    const rally = rallyResult.rows[0];

    //assigning the membership (owner)
    await client.query(
      `INSERT INTO rally_members (rally_id, user_id, role)
       VALUES ($1, $2, $3)`,
      [rally.id, createdByUserId, "OWNER"],
    );

    //saving changes
    await client.query("COMMIT");

    return res.status(201).json({
      status: "success",
      message: "Rally created successfully",
      data: rally,
    });
  } catch (err) {
    //if one of two insertion fails, then rollback, bcz both must happend together or no one should.
    await client.query("ROLLBACK");
    console.log("Failed to create Rally: ", err);

    return res.status(500).json({
      status: "error",
      message: "Failed to create Rally",
    });
  } finally {
    //release the connection so the others can also use it
    client.release();
  }
});

//list rallies a user belongs to
rallyRouter.get("/", authenticateToken, async (req, res) => {
  const userId = res.locals.userId;

  try {
    const result = await pool.query(
      `SELECT
         r.id,
         r.title,
         r.description,
         r.status,
         r.created_by,
         r.created_at,
         r.updated_at,
         rm.role AS user_role,
         COUNT(DISTINCT all_members.user_id)::int AS member_count
       FROM rally_members rm
       JOIN rallies r ON r.id = rm.rally_id
       LEFT JOIN rally_members all_members
         ON all_members.rally_id = r.id
       WHERE rm.user_id = $1
       GROUP BY
         r.id,
         rm.role
       ORDER BY r.updated_at DESC`,
      [userId],
    );

    return res.status(200).json({
      status: "success",
      count: result.rows.length,
      data: result.rows,
    });
  } catch (err) {
    console.error("Failed to list Rallies: ", err);

    return res.status(500).json({
      status: "error",
      message: "Failed to fetch Rallies",
    });
  }
});

//getting specific rally's details along with its members
// rallyRouter.get("/:id", authenticateToken, async (req, res) => {
//   const userId = res.locals.userId;
//   const rallyId = req.params.id;

//   const client = await pool.connect();

//   try {
//     const rallyResult = await client.query(
//       `SELECT r.id, r.title, r.description, r.status, r.created_by, r.created_at, r.updated_at
//       FROM rallies r
//       WHERE r.id = $1`,
//       [rallyId],
//     );

//     if (rallyResult.rows.length === 0) {
//       return res.status(404).json({
//         status: "error",
//         message: "Rally not found",
//       });
//     }

//     const membersResult = await client.query(
//       `SELECT
//          u.id,
//          u.name,
//          u.email,
//          rm.role
//        FROM rally_members rm
//        JOIN users u ON u.id = rm.user_id
//        WHERE rm.rally_id = $1 AND rm.user_id = $2
//        ORDER BY u.name`,
//       [rallyId, userId],
//     );

//     if (membersResult.rows.length === 0) {
//       return res.status(404).json({
//         status: "error",
//         message: "Members not found",
//       });
//     }

//     return res.status(200).json({
//       status: "success",
//       data: {
//         ...rallyResult.rows[0],
//         members: membersResult.rows,
//       },
//     });
//   } catch (err) {
//     console.error("Failed to fetch Rally: ", err);

//     return res.status(500).json({
//       status: "error",
//       message: "Failed to fetch Rally",
//     });
//   } finally {
//     client.release();
//   }
// });
rallyRouter.get("/:id", authenticateToken, async (req, res) => {
  const userId = res.locals.userId;
  const rallyId = req.params.id;

  const client = await pool.connect();

  try {
    // 1. Verify that the logged-in user is a Rally member
    const membershipResult = await client.query(
      `SELECT 1
       FROM rally_members
       WHERE rally_id = $1 AND user_id = $2`,
      [rallyId, userId],
    );

    if (membershipResult.rows.length === 0) {
      return res.status(404).json({
        status: "error",
        message: "Rally not found",
      });
    }

    // 2. Fetch the Rally
    const rallyResult = await client.query(
      `SELECT
         r.id,
         r.title,
         r.description,
         r.status,
         r.created_by,
         r.created_at,
         r.updated_at
       FROM rallies r
       WHERE r.id = $1`,
      [rallyId],
    );

    if (rallyResult.rows.length === 0) {
      return res.status(404).json({
        status: "error",
        message: "Rally not found",
      });
    }

    // 3. Fetch all members of this Rally
    const membersResult = await client.query(
      `SELECT
         u.id,
         u.name,
         u.email,
         rm.role
       FROM rally_members rm
       JOIN users u ON u.id = rm.user_id
       WHERE rm.rally_id = $1
       ORDER BY u.name`,
      [rallyId],
    );

    return res.status(200).json({
      status: "success",
      data: {
        ...rallyResult.rows[0],
        members: membersResult.rows,
      },
    });
  } catch (err) {
    console.error("Failed to fetch Rally:", err);

    return res.status(500).json({
      status: "error",
      message: "Failed to fetch Rally",
    });
  } finally {
    client.release();
  }
});


//update a Rally
// rallyRouter.patch("/:id", authenticateToken, async (req, res) => {
//   const userId = res.locals.userId;
//   const rallyId = req.params.id;
//   const { title, description } = req.body;

//   if (title === undefined && description === undefined) {
//     return res.status(400).json({
//       status: "error",
//       message: "Provide a title or description to update",
//     });
//   }

//   if (title !== undefined && (typeof title !== "string" || !title.trim())) {
//     return res.status(400).json({
//       status: "error",
//       message: "Title must be a non-empty string",
//     });
//   }

//   if (
//     description !== undefined &&
//     description !== null &&
//     typeof description !== "string"
//   ) {
//     return res.status(400).json({
//       status: "error",
//       message: "Description must be a string or null",
//     });
//   }

//   try {

//     const rallyExists = await pool.query(
//     "SELECT id FROM rallies WHERE id = $1",
//     [rallyId],
//   );

//   if (rallyExists.rows.length === 0) {
//     return res.status(404).json({
//       status: "error",
//       message: "Rally not found",
//     });
//   }

//   const ownerResult = await pool.query(
//     `SELECT 1
//      FROM rally_members
//      WHERE rally_id = $1
//        AND user_id = $2
//        AND role = 'OWNER'`,
//     [rallyId, userId],
//   );

//   if (ownerResult.rows.length === 0) {
//     return res.status(403).json({
//       status: "error",
//       message: "Only the Rally owner can edit it",
//     });
//   }
    
// //     const ownerResult = await pool.query(
// //       `SELECT 1
// //       FROM rally_members
// //       WHERE rally_id = $1 AND user_id = $2 AND role = 'OWNER'`,
// //       [rallyId, userId]
// //     );

// //     if(ownerResult.rows.length === 0){
// //       return res.status(403).json({
// //         status: "error",
// //         message: "Only the Rally owner can edit it",
// //       });
// //     }


// //     const rallyExists = await pool.query(
// //   "SELECT id FROM rallies WHERE id = $1",
// //   [rallyId],
// // );

// // if (rallyExists.rows.length === 0) {
// //   return res.status(404).json({
// //     status: "error",
// //     message: "Rally not found",
// //   });
// // }
//     // const membership = await pool.query(
//     //   `SELECT role
//     //    FROM rally_members
//     //    WHERE rally_id = $1 AND user_id = $2`,
//     //   [rallyId, userId],
//     // );

//     // if (membership.rows.length === 0) {
//     //   return res.status(403).json({
//     //     status: "error",
//     //     message: "You are not a member of this Rally",
//     //   });
//     // }

//     // if (membership.rows[0].role !== "OWNER") {
//     //   return res.status(403).json({
//     //     status: "error",
//     //     message: "Only the Rally owner can edit it",
//     //   });
//     // }

//     const result = await pool.query(
//       `UPDATE rallies
//        SET
//          title = COALESCE($1, title),
//          description = CASE
//            WHEN $2::boolean THEN $3::text
//            ELSE description
//          END,
//          updated_at = NOW()
//        WHERE id = $4
//        RETURNING *`,
//       [
//         title === undefined ? null : title.trim(),
//         description !== undefined,
//         description === undefined
//           ? null
//           : description === null
//             ? null
//             : description.trim(),
//         rallyId,
//       ],
//     );

//     if (result.rows.length === 0) {
//       return res.status(404).json({
//         status: "error",
//         message: "Rally not found",
//       });
//     }

//     return res.status(200).json({
//       status: "success",
//       message: "Rally updated successfully",
//       data: result.rows[0],
//     });
//   } catch (err) {
//     console.error("Failed to update Rally:", err);

//     return res.status(500).json({
//       status: "error",
//       message: "Failed to update Rally",
//     });
//   }
// });
rallyRouter.patch("/:id", authenticateToken, async (req, res) => {
  const userId = res.locals.userId;
  const rallyId = req.params.id;
  const { title, description } = req.body;

  // Validate request body
  if (title === undefined && description === undefined) {
    return res.status(400).json({
      status: "error",
      message: "Provide a title or description to update",
    });
  }

  if (
    title !== undefined &&
    (typeof title !== "string" || !title.trim())
  ) {
    return res.status(400).json({
      status: "error",
      message: "Title must be a non-empty string",
    });
  }

  if (
    description !== undefined &&
    description !== null &&
    typeof description !== "string"
  ) {
    return res.status(400).json({
      status: "error",
      message: "Description must be a string or null",
    });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Lock the Rally row to coordinate with concurrent updates/deletes
    const rallyResult = await client.query(
      `SELECT id
       FROM rallies
       WHERE id = $1
       FOR UPDATE`,
      [rallyId],
    );

    if (rallyResult.rows.length === 0) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        status: "error",
        message: "Rally not found",
      });
    }

    // Check ownership using the authenticated user's ID
    const ownerResult = await client.query(
      `SELECT 1
       FROM rally_members
       WHERE rally_id = $1
         AND user_id = $2
         AND role = 'OWNER'`,
      [rallyId, userId],
    );

    if (ownerResult.rows.length === 0) {
      await client.query("ROLLBACK");

      return res.status(403).json({
        status: "error",
        message: "Only the Rally owner can edit it",
      });
    }

    // Update only the fields supplied by the client
    const updateResult = await client.query(
      `UPDATE rallies
       SET
         title = CASE
           WHEN $1::boolean THEN $2::text
           ELSE title
         END,
         description = CASE
           WHEN $3::boolean THEN $4::text
           ELSE description
         END,
         updated_at = NOW()
       WHERE id = $5
       RETURNING *`,
      [
        title !== undefined,
        title === undefined ? null : title.trim(),
        description !== undefined,
        description === undefined
          ? null
          : description === null
            ? null
            : description.trim(),
        rallyId,
      ],
    );

    await client.query("COMMIT");

    return res.status(200).json({
      status: "success",
      message: "Rally updated successfully",
      data: updateResult.rows[0],
    });
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error("Failed to roll back Rally update:", rollbackError);
    }

    console.error("Failed to update Rally:", err);

    return res.status(500).json({
      status: "error",
      message: "Failed to update Rally",
    });
  } finally {
    client.release();
  }
});


// //deleting Rally //only owner can
// rallyRouter.delete("/:id", authenticateToken, async(req,res) => {
//     const userId = res.locals.userId;
//     const rallyId = req.params.id;


//     const client = await pool.connect();

//     try {
//       await client.query("BEGIN");
      
//       //lock the rally row while checking ownership
//       const rallyResult = await client.query(
//         `SELECT id
//         FROM rallies
//         WHERE id = $1
//         FOR UPDATE`,
//         [rallyId],
//       );

//       if(rallyResult.rows.length === 0){
//         await client.query("ROLLBACK");

//         return res.status(404).json({
//           status: "error",
//           message: "Rally not found",
//         });
//       }

//       const ownerResult = await client.query(
//       `SELECT 1
//        FROM rally_members
//        WHERE rally_id = $1
//          AND user_id = $2
//          AND role = 'OWNER'
//          FOR UPDATE`,
//       [rallyId, userId],
//     );

//     if(ownerResult.rows.length === 0){
//       await client.query("ROLLBACK");

//       return res.status(403).json({
//         status: "error",
//         message: "Only the Rally owner can delete it",
//       });
//     }

//     await client.query(
//       "DELETE FROM rallies WHERE id = $1",
//       [rallyId],
//     )

//     await client.query("COMMIT");

//     return res.status(200).json({
//       status: "success",
//       message: "Rally deleted successfully",
//     });

//     } catch (err) {
//       await client.query("ROLLBACK");

//       console.error("Failed to delete Rally: ", err);

//       return res.status(500).json({
//         status: "error",
//         message: "Failed to delete Rally",
//       });
//     }finally{
//       client.release();
//     }
// })
rallyRouter.delete("/:id", authenticateToken, async (req, res) => {
  const userId = res.locals.userId;
  const rallyId = req.params.id;

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Lock the Rally row first, just as the PATCH route does
    const rallyResult = await client.query(
      `SELECT id
       FROM rallies
       WHERE id = $1
       FOR UPDATE`,
      [rallyId],
    );

    if (rallyResult.rows.length === 0) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        status: "error",
        message: "Rally not found",
      });
    }

    // Only the authenticated owner may delete the Rally
    const ownerResult = await client.query(
      `SELECT 1
       FROM rally_members
       WHERE rally_id = $1
         AND user_id = $2
         AND role = 'OWNER'`,
      [rallyId, userId],
    );

    if (ownerResult.rows.length === 0) {
      await client.query("ROLLBACK");

      return res.status(403).json({
        status: "error",
        message: "Only the Rally owner can delete it",
      });
    }

    await client.query(
      `DELETE FROM rallies
       WHERE id = $1`,
      [rallyId],
    );

    await client.query("COMMIT");

    return res.status(200).json({
      status: "success",
      message: "Rally deleted successfully",
    });
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error("Failed to roll back Rally deletion:", rollbackError);
    }

    console.error("Failed to delete Rally:", err);

    return res.status(500).json({
      status: "error",
      message: "Failed to delete Rally",
    });
  } finally {
    client.release();
  }
});






export default rallyRouter;