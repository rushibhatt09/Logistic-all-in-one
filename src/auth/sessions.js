// In-memory session store  (survives until server restarts)
// key  : session token (UUID)
// value: { userId, name, email, role, avatar, loginAt, ip }
export const sessions = new Map();
