import { merge } from 'lodash';
import { normalize } from 'path';
import rtrim from 'rtrim';
import {
  readdir,
  stat,
  unlink,
  access,
  rename,
  copyFile,
  rm,
  mkdir,
  chmod,
} from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { AdapterInterface } from '../adapter.interface';
import { ListContentsResponse } from '../response/list.contents.response';
import { UtilHelper } from '../util.helper';
import { AbstractAdapter } from './abstract.adapter';

export class BunLocalAdapter
  extends AbstractAdapter
  implements AdapterInterface
{
  protected permissions: any = {
    file: {
      public: '0644',
      private: '0600',
    },
    dir: {
      public: '0755',
      private: '0700',
    },
  };

  protected writeFlags?: string;

  protected permissionMap: any;

  constructor(
    root: string,
    writeFlags?: string,
    linkHandling?: number,
    permissions: any[] = [],
  ) {
    super();

    if (typeof Bun === 'undefined') {
      throw new Error(
        'BunLocalAdapter requires Bun runtime. Please use Bun >= 1.0.0',
      );
    }

    this.writeFlags = writeFlags;
    this.permissionMap = merge(this.permissions, permissions);
    this.setPathPrefix(normalize(root));
  }

  public async listContents(
    directory: string,
    recursive: boolean = false,
  ): Promise<ListContentsResponse[]> {
    const location = this.applyPathPrefix(directory);

    if (!(await this.isDir(location))) {
      return [];
    }

    let files: string[] = [];

    if (!recursive) {
      // Non-recursive: use readDir
      try {
        const entries = await readdir(location);
        files = entries.map((file) => location + file);
      } catch (e) {
        files = [];
      }
    } else {
      // Recursive: walk directory tree
      files = await this.recursiveList(location);
    }

    files.sort();

    const response: ListContentsResponse[] = [];

    for (const file of files) {
      response.push(await this.normalizeResponse({ path: file }, ''));
    }

    return response;
  }

  private async recursiveList(rootPath: string): Promise<string[]> {
    const result: string[] = [];

    const walk = async (dir: string): Promise<void> => {
      try {
        const entries = await readdir(dir);

        for (const entry of entries) {
          const fullPath = dir.endsWith('/') ? dir + entry : `${dir}/${entry}`;
          result.push(fullPath);

          // Check if it's a directory
          const fileStat = await stat(fullPath);
          if (fileStat.isDirectory()) {
            await walk(fullPath);
          }
        }
      } catch (err) {
        // Skip directories we can't read
      }
    };

    await walk(rootPath);
    return result;
  }

  protected async normalizeResponse(response: any, path: string): Promise<any> {
    let result: any = {
      path: path ? path : this.removePathPrefix(response.path),
    };

    result = { ...result, ...UtilHelper.pathinfo(result.path) };

    const fileStat = await stat(this.applyPathPrefix(result.path));
    const isFile = fileStat.isFile();
    result.type = isFile ? 'file' : 'dir';
    result.size = fileStat.size;
    result.timestamp = Math.round(fileStat.mtimeMs / 1000);

    if (result.type === 'dir') {
      result.path = rtrim(result.path, '/');
      return result;
    }

    result.type = 'file';
    return result;
  }

  public async write(
    path: string,
    contents: string | Buffer,
    config: any = {},
  ): Promise<any> {
    const location = this.applyPathPrefix(path);

    await this.ensureDirectory(this.getDirname(location));

    await Bun.write(location, contents);

    const result: any = {
      contents,
      type: 'file',
      size: Buffer.byteLength(contents),
      path,
      visibility: 'public',
    };

    if (config.visibility) {
      result.visibility = config.visibility;
    }

    return result;
  }

  public async read(path: string): Promise<any | false> {
    const location = this.applyPathPrefix(path);
    let contents = '';

    try {
      const file = Bun.file(location);
      if (!(await file.exists())) {
        return false;
      }
      contents = await file.text();
    } catch (e) {
      return false;
    }

    return {
      type: 'file',
      path,
      contents,
    };
  }

  public async delete(path: string): Promise<boolean> {
    const location = this.applyPathPrefix(path);
    try {
      await unlink(location);
    } catch (e) {
      return false;
    }
    return true;
  }

  public async has(path: string): Promise<boolean> {
    const location = this.applyPathPrefix(path);
    try {
      await access(location);
      return true;
    } catch (e) {
      return false;
    }
  }

  public async readStream(path: string): Promise<any | false> {
    const location = this.applyPathPrefix(path);
    try {
      return createReadStream(location);
    } catch (e) {
      return false;
    }
  }

  public async getMetadata(path: string): Promise<any> {
    const location: string = this.applyPathPrefix(path);
    const fileStat = await stat(location);
    const timestamp = Math.round(fileStat.mtimeMs / 1000);

    if (fileStat.isFile()) {
      return { type: 'file', path, timestamp, size: fileStat.size };
    }

    if (fileStat.isDirectory()) {
      return { type: 'dir', path, timestamp };
    }
  }

  public async getSize(path: string): Promise<any> {
    return await this.getMetadata(path);
  }

  public async getMimetype(path: string): Promise<any | false> {
    throw new Error('Not implemented yet');
  }

  public async getTimestamp(path: string): Promise<any> {
    return await this.getMetadata(path);
  }

  public async getVisibility(path: string): Promise<any> {
    const location: string = this.applyPathPrefix(path);
    const fileStat = await stat(location);
    const octal = fileStat.mode.toString(8).substr(-4);
    const permissions = parseInt(octal, 8);
    const visibility = permissions & 0o44 ? 'public' : 'private';

    return { path, visibility };
  }

  public async writeStream(
    path: string,
    resource: any,
    config: any = {},
  ): Promise<any> {
    const location = this.applyPathPrefix(path);
    await this.ensureDirectory(this.getDirname(location));

    try {
      const writeStream = createWriteStream(location);
      resource.pipe(writeStream);
      await new Promise((resolve, reject) => {
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
      });
      return {
        type: 'file',
        path,
        size: 0,
      };
    } catch (e) {
      throw new Error('Failed to write stream');
    }
  }

  public async update(
    path: string,
    contents: string,
    config: any = {},
  ): Promise<any> {
    return await this.write(path, contents, config);
  }

  public async updateStream(
    path: string,
    resource: any,
    config: any = {},
  ): Promise<any> {
    return await this.writeStream(path, resource, config);
  }

  public async rename(path: string, newpath: string): Promise<boolean> {
    const location: string = this.applyPathPrefix(path);
    const destination: string = this.applyPathPrefix(newpath);

    try {
      await rename(location, destination);
    } catch (e) {
      return false;
    }
    return true;
  }

  public async copy(path: string, newpath: string): Promise<boolean> {
    const location: string = this.applyPathPrefix(path);
    const destination: string = this.applyPathPrefix(newpath);

    try {
      await copyFile(location, destination);
    } catch (e) {
      return false;
    }
    return true;
  }

  public async deleteDir(path: string): Promise<boolean> {
    const location: string = this.applyPathPrefix(path);
    if (!(await this.isDir(location))) {
      return false;
    }

    try {
      await rm(location, { recursive: true, force: true });
    } catch (e) {
      return false;
    }

    return true;
  }

  public async createDir(
    dirname: string,
    config: any = {},
  ): Promise<any | false> {
    const location: string = this.applyPathPrefix(dirname);
    const visibility = config.visibility ? config.visibility : 'public';

    try {
      await mkdir(location, {
        recursive: true,
        mode: parseInt(this.permissionMap['dir'][visibility], 8),
      });
    } catch (e) {
      return false;
    }

    return { path: dirname, type: 'dir' };
  }

  public async setVisibility(
    path: string,
    visibility: 'public' | 'private',
  ): Promise<any> {
    const location: string = this.applyPathPrefix(path);
    const type: string = (await this.isDir(location)) ? 'dir' : 'file';

    try {
      await chmod(location, parseInt(this.permissionMap[type][visibility], 8));
    } catch (e) {
      return false;
    }

    return { path, visibility };
  }

  protected async isDir(root: string): Promise<boolean> {
    try {
      const statDir = await stat(root);
      return statDir.isDirectory();
    } catch (e) {
      return false;
    }
  }

  protected getDirname(path: string): string {
    const pathList = path.split('/');
    pathList.splice(-1, 1);
    return pathList.join('/');
  }

  protected async ensureDirectory(root: string): Promise<void> {
    if (await this.isDir(root)) {
      return;
    }

    await mkdir(root, {
      recursive: true,
      mode: parseInt(this.permissionMap['dir']['public'], 8),
    });

    if (!(await this.isDir(root))) {
      throw new Error(`Impossible to create the root directory "${root}".`);
    }
  }
}
