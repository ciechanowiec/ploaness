import { postgresAdapter } from '@payloadcms/db-postgres'
import { buildConfig } from 'payload'
import { Articles } from '@/collections/Articles'
import { Media } from '@/collections/Media'
import { Posts } from '@/collections/Posts'
import { Users } from '@/collections/Users'
import { Header } from '@/globals/Header'
import { type Environment, loadEnvironment } from '@/lib/environment'
import { foldersAccess } from '@/lib/folders'

// The configuration Payload boots, and the one the payload-defaults gate imports: the collections it
// builds for the project arrive here, and the folder override is the template's answer to that gate.
// The fail-folders-default-access case removes the override; fail-jobs-default-access adds a task.
const { payloadSecret, databaseUrl }: Environment = loadEnvironment()

export default buildConfig({
  admin: { user: Users.slug },
  collections: [Users, Media, Posts, Articles],
  globals: [Header],
  folders: { collectionOverrides: [foldersAccess] },
  db: postgresAdapter({ pool: { connectionString: databaseUrl }, push: false }),
  secret: payloadSecret,
})
