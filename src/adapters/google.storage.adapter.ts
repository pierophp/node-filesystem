import { trimStart, trimEnd } from 'lodash-es';
import * as mime from 'mime';
import { Storage } from '@google-cloud/storage';
import { AdapterInterface } from '../adapter.interface';
import { ListContentsResponse } from '../response/list.contents.response';
import { UtilHelper } from '../util.helper';
import { AbstractAdapter } from './abstract.adapter';

export class GoogleStorageAdapter
  extends AbstractAdapter
  implements AdapterInterface
{
  protected client: Storage;

  protected bucket: string;

  protected options: any;

  protected resultMap = {
    body: 'contents',
    contentType: 'mimetype',
    size: 'size',
  };

  protected metaOptions = [];

  constructor(
    storageClient: any, // @todo change to Storage when have TS
    bucket: string,
    prefix: string = '',
    options: any = {},
  ) {
    super();

    this.client = storageClient;
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

  public getClient(): Storage {
    return this.client;
  }

  protected normalizeResponse(response: any, path: string) {
    let result: any = {
      path: path
        ? path
        : this.removePathPrefix(
            response.name ? response.name : response.prefix,
          ),
    };

    result = { ...result, ...UtilHelper.pathinfo(result.path) };

    if (response.updated) {
      result.timestamp = Math.round(
        new Date(response.updated).getTime() / 1000,
      );
    }

    if (Array.isArray(response.body)) {
      response.body = response.body[0];
    }

    if (result.path.substr(-1) === '/') {
      result.type = 'dir';
      result.path = trimEnd(result.path, '/');
      return result;
    }

    result.type = 'file';
    const returnFormated = {
      ...result,
      ...UtilHelper.map(response, this.resultMap),
    };

    if (returnFormated.size) {
      returnFormated.size = Number(returnFormated.size);
    }

    return returnFormated;
  }

  /**
   *
   * @todo Implement pagination, that method only return 1000 objects
   */
  public async listContents(
    directory: string,
    recursive: boolean = false,
  ): Promise<ListContentsResponse[]> {
    const prefix = this.applyPathPrefix(
      directory == '/' ? '' : trimEnd(directory, '/') + '/',
    );

    const storageParams: any = {
      prefix,
      autoPaginate: false,
    };

    if (!recursive) {
      storageParams.delimiter = '/';
    }

    const files = await this.getClient()
      .bucket(this.getBucket())
      .getFiles(storageParams);

    const response: ListContentsResponse[] = [];

    for (const file of files[0]) {
      response.push(this.normalizeResponse({ ...file, ...file.metadata }, ''));
    }

    // @ts-ignore
    const prefixes = files && files[2] ? files[2].prefixes : undefined;
    if (prefixes) {
      for (const prefix of prefixes) {
        response.push(this.normalizeResponse({ prefix }, ''));
      }
    }

    const responseEmulated = UtilHelper.emulateDirectories(response).filter(
      (item) => {
        return trimEnd(item.path, '/') !== trimEnd(directory, '/');
      },
    );

    return responseEmulated;
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

    // @todo Veridy this (S3)
    const acl = options['ACL'] ? options['ACL'] : 'private';

    const remoteFile = this.getClient().bucket(this.getBucket()).file(key);

    const contentType = mime.getType(path) || 'application/octet-stream';

    await remoteFile.save(
      Buffer.isBuffer(contents) ? contents : Buffer.from(contents),
      {
        contentType,
      },
    );

    return this.normalizeResponse(
      {
        body: contents,
        size: Buffer.byteLength(contents),
        acl,
        contentType,
      },
      path,
    );
  }

  public async read(path: string): Promise<any | false> {
    const key = this.applyPathPrefix(path);

    const remoteFile = this.getClient().bucket(this.getBucket()).file(key);

    const body = await remoteFile.download();

    const getInfo = await remoteFile.get();

    return this.normalizeResponse(
      {
        ...getInfo[1],
        body,
      },
      path,
    );
  }

  public async delete(path: string): Promise<boolean> {
    const key = this.applyPathPrefix(path);

    try {
      const remoteFile = this.getClient().bucket(this.getBucket()).file(key);

      await remoteFile.delete();
      return true;
    } catch (e) {
      return false;
    }
  }

  public async has(path: string): Promise<boolean> {
    const key = this.applyPathPrefix(path);
    try {
      const remoteFile = this.getClient().bucket(this.getBucket()).file(key);

      await remoteFile.getMetadata();
      return true;
    } catch (e) {
      return false;
    }
  }

  public async readStream(path: string): Promise<any | false> {
    throw new Error('Not implemented yet');
  }

  public async getMetadata(path: string): Promise<any> {
    const key = this.applyPathPrefix(path);

    const remoteFile = this.getClient().bucket(this.getBucket()).file(key);

    const data = await remoteFile.get();

    return this.normalizeResponse(data[1], path);
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
    throw new Error('Not implemented yet');
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

    const remoteSourceFile = this.getClient()
      .bucket(this.getBucket())
      .file(this.applyPathPrefix(path));

    await remoteSourceFile.copy(key);

    return true;
  }

  public async deleteDir(dirname: string): Promise<boolean> {
    const key = trimEnd(this.applyPathPrefix(dirname), '/') + '/';

    const storageParams: any = {
      prefix: key,
    };

    const files = await this.getClient()
      .bucket(this.getBucket())
      .getFiles(storageParams);

    for (const file of files[0]) {
      await file.delete();
    }

    return true;
  }

  public async createDir(dirname: string, config?: any): Promise<any | false> {
    return await this.upload(trimEnd(dirname, '/') + '/', '', config);
  }

  public async setVisibility(
    path: string,
    visibility: 'public' | 'private',
  ): Promise<any | false> {
    throw new Error('Not implemented yet');
  }

  public applyPathPrefix(path) {
    return trimStart(super.applyPathPrefix(path), '/');
  }

  protected getOptionsFromConfig(config) {
    const options = this.options;

    // @todo Verify this (S3)
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
