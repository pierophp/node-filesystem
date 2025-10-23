import {
  S3Client,
  ListObjectsV2Command,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  HeadObjectCommand,
  GetObjectAclCommand,
  CopyObjectCommand,
  PutObjectAclCommand,
  ListObjectsCommand,
} from '@aws-sdk/client-s3';
import * as ltrim from 'ltrim';
import * as mime from 'mime';
import * as rtrim from 'rtrim';
import { AdapterInterface } from '../adapter.interface';
import { ListContentsResponse } from '../response/list.contents.response';
import { UtilHelper } from '../util.helper';
import { AbstractAdapter } from './abstract.adapter';

export class S3Adapter extends AbstractAdapter implements AdapterInterface {
  public readonly PUBLIC_GRANT_URI =
    'http://acs.amazonaws.com/groups/global/AllUsers';

  protected client: S3Client;

  protected bucket: string;

  protected options: any;

  protected resultMap = {
    Body: 'contents',
    ContentLength: 'size',
    ContentType: 'mimetype',
    Size: 'size',
    Metadata: 'metadata',
  };

  protected metaOptions = [
    'CacheControl',
    'Expires',
    'StorageClass',
    'ServerSideEncryption',
    'Metadata',
    'ACL',
    'ContentType',
    'ContentEncoding',
    'ContentDisposition',
    'ContentLength',
    'Tagging',
    'WebsiteRedirectLocation',
    'SSEKMSKeyId',
  ];

  constructor(
    client: S3Client,
    bucket: string,
    prefix: string = '',
    options: any = {},
  ) {
    super();

    this.client = client;
    this.bucket = bucket;
    this.options = options;
    this.setPathPrefix(prefix);
  }

  public getBucket(): string {
    return this.bucket;
  }

  public setBucket(bucket: string): void {
    this.bucket = bucket;
  }

  public getClient(): S3Client {
    return this.client;
  }

  protected async normalizeResponse(response: any, path: string) {
    let result: any = {
      path: path
        ? path
        : this.removePathPrefix(response.Key ? response.Key : response.Prefix),
    };

    result = { ...result, ...UtilHelper.pathinfo(result.path) };

    if (response.LastModified) {
      result.timestamp = new Date(response.LastModified).getTime() / 1000;
    }

    if (response.Body) {
      // In AWS SDK v3, Body is a stream, so we need to convert it to string
      if (typeof response.Body === 'string') {
        response.Body = response.Body;
      } else if (Buffer.isBuffer(response.Body)) {
        response.Body = response.Body.toString();
      } else if (response.Body.transformToString) {
        response.Body = await response.Body.transformToString();
      }
    }

    if (result.path.substr(-1) === '/') {
      result.type = 'dir';
      result.path = rtrim(result.path, '/');

      return result;
    }

    result.type = 'file';

    return {
      ...result,
      ...UtilHelper.map(response, this.resultMap),
    };
  }

  /**
   *
   * @todo Implement pagination, that method only return 1000 objects
   */
  public async listContents(
    directory: string,
    recursive: boolean = false,
  ): Promise<ListContentsResponse[]> {
    const prefix = this.applyPathPrefix(rtrim(directory, '/') + '/');
    const s3Params: any = {
      Bucket: this.getBucket(),
      Prefix: prefix,
    };

    if (!recursive) {
      s3Params.Delimiter = '/';
    }

    const response: ListContentsResponse[] = [];

    try {
      const command = new ListObjectsV2Command(s3Params);
      const data = await this.getClient().send(command);

      if (data.Contents) {
        for (const element of data.Contents) {
          response.push(await this.normalizeResponse(element, ''));
        }
      }

      if (data.CommonPrefixes) {
        for (const element of data.CommonPrefixes) {
          response.push(await this.normalizeResponse(element, ''));
        }
      }

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

    const acl = options['ACL'] ? options['ACL'] : 'private';

    const s3Params = {
      ...{
        Body: Buffer.isBuffer(contents) ? contents : Buffer.from(contents),
        Key: key,
        Bucket: this.getBucket(),
        ContentLength: Buffer.byteLength(contents),
        ContentType: mime.getType(path) || 'application/octet-stream',
        ACL: acl,
      },
      ...options,
    };

    try {
      const command = new PutObjectCommand(s3Params);
      await this.getClient().send(command);
      s3Params.Body = contents;
      return await this.normalizeResponse(s3Params, path);
    } catch (err) {
      throw err;
    }
  }

  public async read(path: string): Promise<any | false> {
    const key = this.applyPathPrefix(path);

    const s3Params = {
      ...{
        Key: key,
        Bucket: this.getBucket(),
      },
      ...this.options,
    };

    try {
      const command = new GetObjectCommand(s3Params);
      const data = await this.getClient().send(command);
      return await this.normalizeResponse(data, path);
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
      const command = new DeleteObjectCommand({
        Bucket: this.getBucket(),
        Key: key,
      });
      await this.getClient().send(command);
      return true;
    } catch (err) {
      return false;
    }
  }

  public async has(path: string): Promise<boolean> {
    const key = this.applyPathPrefix(path);

    try {
      const command = new HeadObjectCommand({
        Bucket: this.getBucket(),
        Key: key,
      });
      await this.getClient().send(command);
      return true;
    } catch (err) {
      return await this.doesDirectoryExist(key);
    }
  }

  public async readStream(path: string): Promise<any | false> {
    throw new Error('Not implemented yet');
  }

  public async getMetadata(path: string): Promise<any> {
    const key = this.applyPathPrefix(path);

    try {
      const command = new HeadObjectCommand({
        Bucket: this.getBucket(),
        Key: key,
      });
      const data = await this.getClient().send(command);
      return await this.normalizeResponse(data, path);
    } catch (err) {
      return false;
    }
  }

  public async getSize(path: string): Promise<any> {
    throw new Error('Not implemented yet');
  }

  public async getMimetype(path: string): Promise<any | false> {
    throw new Error('Not implemented yet');
  }

  public async getTimestamp(path: string): Promise<any | false> {
    throw new Error('Not implemented yet');
  }

  public async getVisibility(path: string): Promise<any | false> {
    return { visibility: await this.getRawVisibility(path) };
  }

  protected async getRawVisibility(path: string): Promise<any | false> {
    const key = this.applyPathPrefix(path);

    try {
      const command = new GetObjectAclCommand({
        Bucket: this.getBucket(),
        Key: key,
      });
      const data = await this.getClient().send(command);

      let visibility = 'private';

      if (data.Grants) {
        data.Grants.forEach((grant) => {
          if (
            grant.Grantee &&
            grant.Grantee.URI &&
            grant.Grantee.URI === this.PUBLIC_GRANT_URI &&
            grant.Permission === 'READ'
          ) {
            visibility = 'public';
          }
        });
      }

      return visibility;
    } catch (err) {
      console.log('getRawVisibilityError', err);
      return 'private';
    }
  }

  public async writeStream(
    path: string,
    resource: any,
    config?: any,
  ): Promise<any> {
    throw new Error('Not implemented yet');
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
    throw new Error('Not implemented yet');
  }

  public async rename(path: string, newpath: string): Promise<boolean> {
    if (!(await this.copy(path, newpath))) {
      return false;
    }

    return await this.delete(path);
  }

  public async copy(path: string, newpath: string): Promise<boolean> {
    const key = this.applyPathPrefix(newpath);

    try {
      const command = new CopyObjectCommand({
        ...{
          Bucket: this.getBucket(),
          Key: key,
          CopySource: encodeURIComponent(
            this.getBucket() + '/' + this.applyPathPrefix(path),
          ),
          ACL:
            (await this.getRawVisibility(path)) === 'public'
              ? 'public-read'
              : 'private',
        },
        ...this.options,
      });
      await this.getClient().send(command);
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
        // List all objects with the prefix
        const listCommand = new ListObjectsV2Command({
          Bucket: this.getBucket(),
          Prefix: prefix,
          ContinuationToken: continuationToken,
        });

        const listResult = await this.getClient().send(listCommand);

        if (!listResult.Contents || listResult.Contents.length === 0) {
          return true;
        }

        // Delete objects in batch
        const deleteCommand = new DeleteObjectsCommand({
          Bucket: this.getBucket(),
          Delete: {
            Objects: listResult.Contents.map((item) => ({ Key: item.Key! })),
            Quiet: true,
          },
        });

        await this.getClient().send(deleteCommand);

        continuationToken = listResult.NextContinuationToken;
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
    const key = this.applyPathPrefix(path);

    try {
      const command = new PutObjectAclCommand({
        Bucket: this.getBucket(),
        Key: key,
        ACL: visibility === 'public' ? 'public-read' : 'private',
      });
      await this.getClient().send(command);
      return { path, visibility };
    } catch (err) {
      return false;
    }
  }

  protected async doesDirectoryExist(location: string): Promise<boolean> {
    try {
      const command = new ListObjectsCommand({
        Bucket: this.getBucket(),
        Prefix: rtrim(location, '/') + '/',
        MaxKeys: 1,
      });
      const data = await this.getClient().send(command);

      return !!(
        (data.Contents && data.Contents.length) ||
        (data.CommonPrefixes && data.CommonPrefixes.length)
      );
    } catch (err) {
      return false;
    }
  }

  public applyPathPrefix(path) {
    return ltrim(super.applyPathPrefix(path), '/');
  }

  protected getOptionsFromConfig(config) {
    const options = this.options;

    if (config && config.visibility) {
      options.visibility = config.visibility;
      options.ACL = config.visibility === 'public' ? 'public-read' : 'private';
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
