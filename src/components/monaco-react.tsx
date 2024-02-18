import Editor from "@monaco-editor/react";

type Props = {
  defaultCode: string;
};

export function MonacoReact({ defaultCode }: Props) {
  return <Editor defaultLanguage="go" defaultValue={defaultCode} />;
}
