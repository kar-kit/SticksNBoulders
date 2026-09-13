/**
 * The narrow row-writing surface the helper needs.
 *
 * Exists so the helper can be tested against a fake, and so the SDK's row
 * methods are imported in exactly one file. If this interface is implemented
 * anywhere other than `appwrite/documents/`, the guard test will say so.
 */
export interface RowWriter {
  createRow(params: {
    databaseId: string;
    tableId: string;
    rowId: string;
    data: Record<string, unknown>;
    permissions?: string[];
  }): Promise<{ $id: string } & Record<string, unknown>>;

  updateRow(params: {
    databaseId: string;
    tableId: string;
    rowId: string;
    data?: Record<string, unknown>;
    permissions?: string[];
  }): Promise<{ $id: string } & Record<string, unknown>>;

  deleteRow(params: { databaseId: string; tableId: string; rowId: string }): Promise<unknown>;
}
