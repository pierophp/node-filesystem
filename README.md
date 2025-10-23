# Node File System

This project was inspired on the great PHP package [Flysystem](https://flysystem.thephpleague.com/), and tries to be API compatible when possible. It's a work in progress. Pull requests are welcome.

Like Flysystem, is a filesystem abstraction which allows you to easily swap out a local filesystem for a remote one.

It's made with Typescript. All methods are async.

## Goals

- Have a generic API for handling common tasks across multiple file storage engines.
- Have consistent output which you can rely on.
- Emulate directories in systems that support none, like AwsS3.

## Installation

Using YARN:

```
yarn add node-filesystem
```

Using NPM:

```
npm add node-filesystem --save
```

## Core concepts

See [Flysysytem docs](https://flysystem.thephpleague.com/core-concepts/)

## The API

### Write Files

```typescript
await filesystem.write('path/to/file.txt', 'contents');
```

### Update Files

```typescript
await filesystem.update('path/to/file.txt', 'new contents');
```

### Write or Update Files

```typescript
await filesystem.put('path/to/file.txt', 'contents');
```

### Read Files

```typescript
const contents = await filesystem.read('path/to/file.txt');
```

### Check if a file exists

```typescript
const exists = await filesystem.has('path/to/file.txt');
```

**NOTE:** This only has consistent behaviour for files, not directories. Directories are less important, they’re created implicitly and often ignored because not every adapter (filesystem type) supports directories.

### Delete Files

```typescript
await filesystem.delete('path/to/file.txt');
```

### Rename Files

```typescript
await filesystem.rename('filename.txt', 'newname.txt');
```

### Copy Files

```typescript
await filesystem.copy('filename.txt', 'duplicate.txt');
```

### Get Mimetypes

```typescript
const mimetype = await filesystem.getMimetype('path/to/file.txt');
```

### Get Timestamps

```typescript
const timestamp = await filesystem.getTimestamp('path/to/file.txt');
```

### Get File Sizes

```typescript
const size = await filesystem.getSize('path/to/file.txt');
```

### Create Directories

```typescript
await filesystem.createDir('path/to/nested/directory');
```

### Directories are also made implicitly when writing to a deeper path

```typescript
await filesystem.write('path/to/file.txt', 'contents');
```

### Delete Directories

```typescript
await filesystem.deleteDir('path/to/directory');
```

The above method will delete directories recursively

**NOTE:** All paths used are relative to the adapter root directory.

### Manage Visibility

Visibility is the abstraction of file permissions across multiple platforms. Visibility can be either public or private.

```typescript
await filesystem.write('db.backup', backup, {
  visibility: 'private',
});
```

You can also change and check visibility of existing files

```typescript
if ((await filesystem.getVisibility('secret.txt')) === 'private') {
  await filesystem.setVisibility('secret.txt', 'public');
}
```

### List Contents

```typescript
const contents = await filesystem.listContents();
```

The result of a contents listing is a collection of arrays containing all the metadata the file manager knows at that time. By default you’ll receive path info and file type. Additional info could be supplied by default depending on the adapter used.

Example:

```typescript
for (const object of contents) {
  console.log(
    object.basename,
    ' is located at ',
    object.path,
    ' and is a ',
    object.type,
  );
}
```

By default it lists the top directory non-recursively. You can supply a directory name and recursive boolean to get more precise results

```typescript
const contents = filesystem.listContents('some/dir', true);
```

## Adapters

### Local

```typescript
import { LocalAdapter } from 'node-filesystem';

new LocalAdapter('my-root-folder', 'my-subfolder');
```

### Aws S3

You need install the official AWS SDK v3:

```
yarn add @aws-sdk/client-s3
```

```typescript
import { S3Client } from '@aws-sdk/client-s3';
import { S3Adapter } from 'node-filesystem';

const s3Client = new S3Client({
  credentials: {
    accessKeyId: 'my-aws-access-key',
    secretAccessKey: 'my-aws-secret-key',
  },
  region: 'my-aws-region',
});

new S3Adapter(s3Client, 'my-bucket', 'my-subfolder');
```

### Bun S3 (Native)

If you're using [Bun](https://bun.sh) runtime (>= 1.1.30), you can use the native Bun S3 adapter which has better performance:

No additional dependencies needed - Bun has built-in S3 support!

```typescript
import { BunAdapter } from 'node-filesystem';

const adapter = new BunAdapter(
  {
    accessKeyId: 'my-aws-access-key',
    secretAccessKey: 'my-aws-secret-key',
    region: 'my-aws-region',
    bucket: 'my-bucket',
    endpoint: 'https://s3.amazonaws.com', // optional, for S3-compatible services
  },
  'my-subfolder', // optional prefix
);
```

**Benefits of BunAdapter:**

- No external dependencies required
- Better performance with Bun's native implementation
- Smaller bundle size
- Native stream support
- Compatible with S3 and S3-compatible services (DigitalOcean Spaces, Cloudflare R2, etc.)

**Note:** This adapter requires Bun runtime and won't work in Node.js.

### Google Cloud Storage

```typescript
import * as Storage from '@google-cloud/storage';
import { GoogleStorage } from 'node-filesystem';

const googleStorageClient = new Storage({
  projectId: '',
});

process.env.GOOGLE_APPLICATION_CREDENTIALS =
  __dirname + '/../gcp-credentials.json';

new GoogleStorage(googleStorageClient, 'my-bucket', 'my-subfolder');
```

### DigitalOcean Spaces

You can use the AWS S3 Adapter
