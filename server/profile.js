// server/profileHandler.js
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs').promises;
const pool = require('./db');

class ProfileHandler {
  static async submitProfile(userId, profileData, idFile) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // Check if user already has Profile info
      const [existing] = await conn.execute(
        'SELECT id FROM profile WHERE user_id = ?',
        [userId],
      );

      if (existing.length > 0) {
        throw new Error('Profile information already submitted');
      }

      // Save ID document
      const fileExt = path.extname(idFile.originalname);
      const fileName = `${userId}_${Date.now()}${fileExt}`;
      const filePath = path.join('uploads', 'profile', fileName);

      // Ensure upload directory exists
      await fs.mkdir(path.join('uploads', 'profile'), { recursive: true });
      await fs.writeFile(path.join('uploads', 'profile', fileName), idFile.buffer);

      // Insert Profile info
      const profileId = uuidv4();
      await conn.execute(
        `INSERT INTO profile (
                    id, user_id, first_name, last_name, date_of_birth,
                    nationality, email, phone, street_address, street_address2,
                    city, state_province, postal_code, country,
                    id_type, id_number, id_expiry, id_document_path
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          profileId, userId, profileData.firstName, profileData.lastName, profileData.dob,
          profileData.nationality, profileData.email, profileData.phone,
          profileData.street, profileData.street2 || null, profileData.city,
          profileData.state, profileData.postal, profileData.country,
          profileData.idType, profileData.idNumber, profileData.idExpiry, filePath,
        ],
      );

      await conn.commit();
      return { id: profileId, status: 'pending' };
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  }

  static async getProfileStatus(userId) {
    const [results] = await pool.execute(
      `SELECT id, status, created_at, verified_at, rejection_reason 
             FROM profile WHERE user_id = ?`,
      [userId],
    );

    if (results.length === 0) {
      return null;
    }

    return results[0];
  }

  static async getProfileInfo(userId) {
    const [results] = await pool.execute(
      'SELECT * FROM profile WHERE user_id = ?',
      [userId],
    );

    if (results.length === 0) {
      return null;
    }

    // Remove sensitive path information
    const info = results[0];
    delete info.id_document_path;
    return info;
  }

  static async updateProfileStatus(profileId, status, verifierId, rejectionReason = null) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const params = [
        status,
        status === 'approved' || status === 'rejected' ? new Date() : null,
        status === 'approved' || status === 'rejected' ? verifierId : null,
        rejectionReason,
        profileId,
      ];

      await conn.execute(
        `UPDATE profile 
                 SET status = ?, verified_at = ?, verified_by = ?, rejection_reason = ?
                 WHERE id = ?`,
        params,
      );

      await conn.commit();
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  }
}

module.exports = ProfileHandler;
