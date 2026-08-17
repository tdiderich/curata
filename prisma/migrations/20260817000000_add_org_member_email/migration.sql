-- Display identity for auth modes whose userId is an opaque provider id
ALTER TABLE "org_members" ADD COLUMN "email" TEXT;
