import * as ltrim from 'ltrim';
import * as mime from 'mime';
import * as rtrim from 'rtrim';
import { S3Client } from 'bun';
import { AdapterInterface } from '../adapter.interface';
import { ListContentsResponse } from '../response/list.contents.response';
import { UtilHelper } from '../util.helper';
import { AbstractAdapter } from './abstract.adapter';

interface BunAdapterOptions {
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  endpoint?: string;
  region?: string;
}

export class BunAdapter extends AbstractAdapter implements AdapterInterface {
  public readonly PUBLIC_GRANT_URI =
    'http://acs.amazonaws.com/groups/global/AllUsers';

  protected bucket: string;
  protected options: BunAdapterOptions;
  protected s3: S3Client;

  protected resultMap = {
    Body: 'contents',
    size: 'size',
    type: 'mimetype',
    lastModified: 'timestamp',
  };

  protected metaOptions = [
    'CacheControl',
    'Expires',
    'StorageClass',
    'Metadata',
    'ACL',
    'ContentType',
    'ContentEncoding',
    'ContentDisposition',
    'ContentLength',
  ];

  constructor(options: BunAdapterOptions, prefix: string = '') {
    super();

    if (typeof Bun === 'undefined' || !Bun.s3) {
      throw new Error(
        'BunAdapter requires Bun runtime with S3 support. Please use Bun >= 1.1.30',
      );
    }

    this.bucket = options.bucket;
    this.options = options;
    this.s3 = new S3Client({
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey,
      endpoint: options.endpoint,
      region: options.region || 'us-east-1',
      bucket: options.bucket,
    });
    this.setPathPrefix(prefix);
  }

  public getBucket(): string {
    return this.bucket;
  }

  public setBucket(bucket: string): void {
    this.bucket = bucket;
    this.s3 = new S3Client({
      ...this.options,
      bucket,
    });
  }

  public getClient(): S3Client {
    return this.s3;
  }

  protected async normalizeResponse(response: any, path: string) {
    let result: any = {
      path: path || this.removePathPrefix(response.key || response.Key || ''),
    };

    result = { ...result, ...UtilHelper.pathinfo(result.path) };

    if (response.lastModified || response.LastModified) {
      const date = response.lastModified || response.LastModified;
      result.timestamp = new Date(date).getTime() / 1000;
    }

    if (response.Body || response.body) {
      const body = response.Body || response.body;
      if (typeof body === 'string') {
        response.Body = body;
      } else if (Buffer.isBuffer(body)) {
        response.Body = body.toString();
      } else if (body instanceof Blob) {
        response.Body = await body.text();
      }
    }

    if (result.path.substr(-1) === '/') {
      result.type = 'dir';
      result.path = rtrim(result.path, '/');
      return result;
    }

    result.type = 'file';
    result.size = response.size || response.Size || response.ContentLength || 0;

    return {
      ...result,
      ...UtilHelper.map(response, this.resultMap),
    };
  }

  public async listContents(
    directory: string,
    recursive: boolean = false,
  ): Promise<ListContentsResponse[]> {
    const prefix = this.applyPathPrefix(rtrim(directory, '/') + '/');
    const response: ListContentsResponse[] = [];

    try {
      let continuationToken: string | undefined;

      do {
        const result = await this.s3.list({
          prefix,
          delimiter: recursive ? undefined : '/',
          continuationToken,
        });

        if (result.contents) {
          for (const obj of result.contents) {
            response.push(await this.normalizeResponse(obj, ''));
          }
        }

        if (result.commonPrefixes) {
          for (const prefixObj of result.commonPrefixes) {
            response.push(
              await this.normalizeResponse(
                { key: prefixObj.prefix, Key: prefixObj.prefix },
                '',
              ),
            );
          }
        }

        continuationToken = result.continuationToken;
      } while (continuationToken);

      const responseEmulated = UtilHelper.emulateDirectories(response).filter(
        (item) => {
          return rtrim(item.path, '/') !== rtrim(directory, '/');
        },
      );

      return responseEmulated;
    } catch (err) {
      throw err;
    }
  }

  public async write(
    path: string,
    contents: string | Buffer,
    config: any = {},
  ): Promise<any> {
    return await this.upload(path, contents, config);
  }

  protected async upload(
    path: string,
    contents: string | Buffer,
    config: any = {},
  ): Promise<any> {
    const key = this.applyPathPrefix(path);
    const options = this.getOptionsFromConfig(config);

    try {
      await this.s3.write(key, contents, {
        type: mime.getType(path) || 'application/octet-stream',
        ...options,
      });

      const uploadResult = {
        Body: contents,
        Key: key,
        size: Buffer.byteLength(contents),
        ContentType: mime.getType(path) || 'application/octet-stream',
      };

      return await this.normalizeResponse(uploadResult, path);
    } catch (err) {
      throw err;
    }
  }

  public async read(path: string): Promise<any | false> {
    const key = this.applyPathPrefix(path);

    try {
      const file = this.s3.file(key);
      const [data, stats] = await Promise.all([file.text(), file.stat()]);

      return await this.normalizeResponse(
        {
          Body: data,
          key,
          size: stats.size,
          lastModified: stats.lastModified,
        },
        path,
      );
    } catch (err) {
      throw err;
    }
  }

  public async delete(path: string): Promise<boolean> {
    const key = this.applyPathPrefix(path);

    if (path[path.length - 1] === '/') {
      return false;
    }

    try {
      await this.s3.delete(key);
      return true;
    } catch (err) {
      return false;
    }
  }

  public async has(path: string): Promise<boolean> {
    const key = this.applyPathPrefix(path);

    try {
      const file = this.s3.file(key);
      const exists = await file.exists();

      if (exists) {
        return true;
      }

      return await this.doesDirectoryExist(key);
    } catch (err) {
      return await this.doesDirectoryExist(key);
    }
  }

  public async readStream(path: string): Promise<any | false> {
    const key = this.applyPathPrefix(path);

    try {
      const file = this.s3.file(key);
      return file.stream();
    } catch (err) {
      throw err;
    }
  }

  public async getMetadata(path: string): Promise<any> {
    const key = this.applyPathPrefix(path);

    try {
      const file = this.s3.file(key);
      const exists = await file.exists();

      if (!exists) {
        return false;
      }

      const stats = await file.stat();

      return await this.normalizeResponse(
        {
          key,
          size: stats.size,
          lastModified: stats.lastModified,
          etag: stats.etag,
        },
        path,
      );
    } catch (err) {
      return false;
    }
  }

  public async getSize(path: string): Promise<any> {
    const metadata = await this.getMetadata(path);
    return metadata ? { size: metadata.size } : false;
  }

  public async getMimetype(path: string): Promise<any | false> {
    const metadata = await this.getMetadata(path);
    return metadata
      ? { mimetype: mime.getType(path) || 'application/octet-stream' }
      : false;
  }

  public async getTimestamp(path: string): Promise<any | false> {
    const metadata = await this.getMetadata(path);
    return metadata ? { timestamp: metadata.timestamp } : false;
  }

  public async getVisibility(path: string): Promise<any | false> {
    // Bun S3 doesn't expose ACL information directly
    // This would need to be tracked separately or use presigned URLs
    return { visibility: 'private' };
  }

  public async writeStream(
    path: string,
    resource: any,
    config?: any,
  ): Promise<any> {
    const key = this.applyPathPrefix(path);
    const options = this.getOptionsFromConfig(config || {});

    try {
      await this.s3.write(key, resource, {
        type: mime.getType(path) || 'application/octet-stream',
        ...options,
      });

      return await this.normalizeResponse(
        {
          Key: key,
          ContentType: mime.getType(path) || 'application/octet-stream',
        },
        path,
      );
    } catch (err) {
      throw err;
    }
  }

  public async update(
    path: string,
    contents: string,
    config?: any,
  ): Promise<any> {
    return await this.upload(path, contents, config);
  }

  public async updateStream(
    path: string,
    resource: any,
    config?: any,
  ): Promise<any> {
    return await this.writeStream(path, resource, config);
  }

  public async rename(path: string, newpath: string): Promise<boolean> {
    if (!(await this.copy(path, newpath))) {
      return false;
    }

    return await this.delete(path);
  }

  public async copy(path: string, newpath: string): Promise<boolean> {
    try {
      const key = this.applyPathPrefix(path);
      const newKey = this.applyPathPrefix(newpath);

      // Read the source file
      const file = this.s3.file(key);
      const data = await file.arrayBuffer();

      // Write to new location
      await this.s3.write(newKey, data, {
        type: mime.getType(newpath) || 'application/octet-stream',
      });

      return true;
    } catch (err) {
      return false;
    }
  }

  public async deleteDir(dirname: string): Promise<boolean> {
    const prefix = rtrim(this.applyPathPrefix(dirname), '/') + '/';

    try {
      let continuationToken: string | undefined;

      do {
        const result = await this.s3.list({
          prefix,
          continuationToken,
        });

        if (!result.contents || result.contents.length === 0) {
          return true;
        }

        // Delete objects in batch
        const deletePromises = result.contents.map((obj) =>
          this.s3.delete(obj.key),
        );

        await Promise.all(deletePromises);

        continuationToken = result.continuationToken;
      } while (continuationToken);

      return true;
    } catch (err) {
      return false;
    }
  }

  public async createDir(dirname: string, config?: any): Promise<any | false> {
    return await this.upload(rtrim(dirname, '/') + '/', '', config);
  }

  public async setVisibility(
    path: string,
    visibility: 'public' | 'private',
  ): Promise<any | false> {
    // Bun S3 doesn't expose ACL management directly
    // This would need to be implemented with presigned URLs or external ACL management
    console.warn(
      'BunAdapter does not support setVisibility. ACL management is not available in Bun S3 API.',
    );
    return { path, visibility };
  }

  protected async doesDirectoryExist(location: string): Promise<boolean> {
    try {
      const result = await this.s3.list({
        prefix: rtrim(location, '/') + '/',
        maxKeys: 1,
      });

      return !!(result.contents && result.contents.length > 0);
    } catch (err) {
      return false;
    }
  }

  public applyPathPrefix(path) {
    return ltrim(super.applyPathPrefix(path), '/');
  }

  protected getOptionsFromConfig(config) {
    const options: any = {};

    if (config && config.visibility) {
      options.visibility = config.visibility;
    }

    for (const option of this.metaOptions) {
      if (!config[option]) {
        continue;
      }

      options[option] = config[option];
    }

    return options;
  }
}
