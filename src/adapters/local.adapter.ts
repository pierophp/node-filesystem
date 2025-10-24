import {
  chmod,
  copy,
  mkdirs,
  move,
  readFile,
  readdir,
  remove,
  stat,
  unlink,
  writeFile,
} from 'fs-extra';
import { merge, trimEnd } from 'lodash-es';
import { paths } from 'node-dir';
import { normalize } from 'path';
import { AdapterInterface } from '../adapter.interface';
import { ListContentsResponse } from '../response/list.contents.response';
import { UtilHelper } from '../util.helper';
import { AbstractAdapter } from './abstract.adapter';

export class LocalAdapter extends AbstractAdapter implements AdapterInterface {
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

    this.writeFlags = writeFlags;
    this.permissionMap = merge(this.permissions, permissions);
    this.setPathPrefix(normalize(root));
  }

  public async listContents(
    directory: string,
    recursive: boolean = false,
  ): Promise<ListContentsResponse[]> {
    const location = this.applyPathPrefix(directory);

    if (!(await this.isDir(location)!)) {
      return [];
    }

    let files: any[] = [];
    if (!recursive) {
      files = await readdir(location, 'utf8');
      files = files.map((file) => {
        return location + file;
      });
    } else {
      files = await new Promise<any[]>((done) => {
        paths(location, (err, paths) => {
          const fileList: string[] = [];
          for (const file of paths.files) {
            fileList.push(file);
          }

          for (const dir of paths.dirs) {
            fileList.push(dir);
          }

          done(fileList);
        });
      });
    }

    files.sort();

    const response: ListContentsResponse[] = [];

    for (const file of files) {
      response.push(await this.normalizeResponse({ path: file }, ''));
    }

    return response;
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
      result.path = trimEnd(result.path, '/');

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
    const options: any = {};

    if (this.writeFlags) {
      options.flag = this.writeFlags;
    }

    await this.ensureDirectory(this.getDirname(location));
    await writeFile(location, contents, options);

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
      contents = await readFile(location);
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
      const statDir = await stat(location);
    } catch (e) {
      return false;
    }

    return true;
  }

  public async readStream(path: string): Promise<any | false> {
    throw new Error('Not implemented yet');
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
    throw new Error('Not implemented yet');
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
    throw new Error('Not implemented yet');
  }

  public async rename(path: string, newpath: string): Promise<boolean> {
    const location: string = this.applyPathPrefix(path);
    const destination: string = this.applyPathPrefix(newpath);

    try {
      await move(location, destination);
    } catch (e) {
      return false;
    }
    return true;
  }

  public async copy(path: string, newpath: string): Promise<boolean> {
    const location: string = this.applyPathPrefix(path);
    const destination: string = this.applyPathPrefix(newpath);

    try {
      await copy(location, destination);
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
      await remove(location);
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
    /**
     * @todo implements umask
     */
    try {
      await mkdirs(location, this.permissionMap['dir'][visibility]);
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
      await chmod(location, this.permissionMap[type][visibility]);
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

    /**
     * @todo implements umask
     */

    await mkdirs(root, this.permissionMap['dir']['public']);

    if (!(await this.isDir(root))) {
      throw new Error(`Impossible to create the root directory "${root}".`);
    }
  }
}
