import { MASK_CACHE_LIMIT_BYTES } from './limits'
import type { ProjectSnapshot } from '../types'

const DATABASE_NAME = 'isolate-local'
const DATABASE_VERSION = 1
const PROJECTS = 'projects'
const MASKS = 'masks'

interface StoredMask {
  key: string
  projectId: string
  frameIndex: number
  blob: Blob
  bytes: number
  updatedAt: number
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'))
  })
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted.'))
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed.'))
  })
}

async function openDatabase(): Promise<IDBDatabase> {
  const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
  request.onupgradeneeded = () => {
    const database = request.result
    if (!database.objectStoreNames.contains(PROJECTS)) {
      database.createObjectStore(PROJECTS, { keyPath: 'clip.id' })
    }
    if (!database.objectStoreNames.contains(MASKS)) {
      const masks = database.createObjectStore(MASKS, { keyPath: 'key' })
      masks.createIndex('projectId', 'projectId', { unique: false })
    }
  }
  return requestResult(request)
}

export class ProjectStorage {
  private databasePromise = openDatabase()

  async saveSnapshot(snapshot: ProjectSnapshot) {
    const database = await this.databasePromise
    const transaction = database.transaction(PROJECTS, 'readwrite')
    transaction.objectStore(PROJECTS).put(snapshot)
    await transactionDone(transaction)
  }

  async latestSnapshot(): Promise<ProjectSnapshot | null> {
    const database = await this.databasePromise
    const transaction = database.transaction(PROJECTS, 'readonly')
    const snapshots = await requestResult(transaction.objectStore(PROJECTS).getAll())
    return (snapshots as ProjectSnapshot[]).sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null
  }

  async putMask(projectId: string, frameIndex: number, blob: Blob, currentBytes: number) {
    const database = await this.databasePromise
    const key = `${projectId}:${frameIndex}`
    const readTransaction = database.transaction(MASKS, 'readonly')
    const previous = (await requestResult(readTransaction.objectStore(MASKS).get(key))) as StoredMask | undefined
    const nextBytes = currentBytes - (previous?.bytes ?? 0) + blob.size
    if (nextBytes > MASK_CACHE_LIMIT_BYTES) {
      throw new Error('Mask cache reached 64 MB. Download this sequence or start a smaller clip.')
    }
    const transaction = database.transaction(MASKS, 'readwrite')
    transaction.objectStore(MASKS).put({
      key,
      projectId,
      frameIndex,
      blob,
      bytes: blob.size,
      updatedAt: Date.now(),
    } satisfies StoredMask)
    await transactionDone(transaction)
    return nextBytes
  }

  async getMask(projectId: string, frameIndex: number): Promise<Blob | null> {
    const database = await this.databasePromise
    const transaction = database.transaction(MASKS, 'readonly')
    const record = (await requestResult(
      transaction.objectStore(MASKS).get(`${projectId}:${frameIndex}`),
    )) as StoredMask | undefined
    return record?.blob ?? null
  }

  async getAllMasks(projectId: string): Promise<Array<{ frameIndex: number; blob: Blob }>> {
    const database = await this.databasePromise
    const transaction = database.transaction(MASKS, 'readonly')
    const index = transaction.objectStore(MASKS).index('projectId')
    const records = (await requestResult(index.getAll(IDBKeyRange.only(projectId)))) as StoredMask[]
    return records
      .sort((a, b) => a.frameIndex - b.frameIndex)
      .map(({ frameIndex, blob }) => ({ frameIndex, blob }))
  }

  async clearProject(projectId: string) {
    const database = await this.databasePromise
    const transaction = database.transaction([PROJECTS, MASKS], 'readwrite')
    transaction.objectStore(PROJECTS).delete(projectId)
    const maskStore = transaction.objectStore(MASKS)
    const cursorRequest = maskStore.index('projectId').openCursor(IDBKeyRange.only(projectId))
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result
      if (cursor) {
        cursor.delete()
        cursor.continue()
      }
    }
    await transactionDone(transaction)
  }
}

