import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { useEditor } from '../../../editor';
import { createDocument, saveDocument, loadDocument, listDocuments, deleteDocument } from '../../../services';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { RefreshCw, Upload, Save, Plus, Trash2, List, Loader2 } from 'lucide-react';

export function JsonPanel() {
  const { getJSON, setFromJSON, save, doc } = useEditor();
  const [text, setText] = useState('');
  const [documentId, setDocumentId] = useState('');
  const [loading, setLoading] = useState(false);
  const [documents, setDocuments] = useState<any[]>([]);
  const [count, setCount] = useState<number>(0);

  useEffect(() => {
    setText(getJSON());
  }, [getJSON]);

  const onLoad = () => {
    try {
      setFromJSON(text);
    } catch (e) {
      alert('Invalid JSON. Expecting an object with a blocks array.');
    }
  };

  const onCreate = async () => {
    try {
      setLoading(true);
      const res = await createDocument(doc);
      setDocumentId(res.document_id);
      alert(`Document created with id: ${res.document_id}`);
    } catch (e: any) {
      alert(`Create failed: ${e?.message || 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  const onSaveById = async () => {
    if (!documentId) return alert('Enter a document ID first');
    try {
      setLoading(true);
      const res = await saveDocument(documentId, doc);
      alert(res.message || 'Saved');
    } catch (e: any) {
      alert(`Save failed: ${e?.message || 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  const onLoadById = async () => {
    if (!documentId) return alert('Enter a document ID first');
    try {
      setLoading(true);
      const loaded = await loadDocument(documentId);
      setFromJSON(JSON.stringify(loaded));
      setText(JSON.stringify(loaded, null, 2));
    } catch (e: any) {
      alert(`Load failed: ${e?.message || 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  const onDeleteById = async () => {
    if (!documentId) return alert('Enter a document ID first');
    if (!confirm(`Delete document ${documentId}?`)) return;
    try {
      setLoading(true);
      const res = await deleteDocument(documentId);
      alert(res.message || 'Deleted');
      setDocumentId('');
    } catch (e: any) {
      alert(`Delete failed: ${e?.message || 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  const onList = async () => {
    try {
      setLoading(true);
      const res = await listDocuments(1, 10);
      setDocuments(res.documents || []);
      setCount(res.count || 0);
    } catch (e: any) {
      alert(`List failed: ${e?.message || 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 h-full">
      {/* Document ID Input */}
      <div className="space-y-2">
        <Input
          className="font-mono text-xs"
          placeholder="Document ID"
          value={documentId}
          onChange={(e) => setDocumentId(e.target.value)}
        />
        
        {/* API Actions */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <Button 
            variant="outline" 
            size="sm" 
            disabled={loading} 
            onClick={onCreate}
            className="gap-1.5"
          >
            {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
            Create
          </Button>
          <Button 
            variant="outline" 
            size="sm" 
            disabled={loading} 
            onClick={onSaveById}
            className="gap-1.5"
          >
            <Save className="h-3 w-3" />
            Save
          </Button>
          <Button 
            variant="outline" 
            size="sm" 
            disabled={loading} 
            onClick={onLoadById}
            className="gap-1.5"
          >
            <Upload className="h-3 w-3" />
            Load
          </Button>
          <Button 
            variant="destructive" 
            size="sm" 
            disabled={loading} 
            onClick={onDeleteById}
            className="gap-1.5"
          >
            <Trash2 className="h-3 w-3" />
            Delete
          </Button>
          <Button 
            variant="outline" 
            size="sm" 
            disabled={loading} 
            onClick={onList}
            className="gap-1.5"
          >
            <List className="h-3 w-3" />
            List
          </Button>
        </div>
      </div>

      {/* Divider */}
      <div className="h-px bg-border" />

      {/* Local Actions */}
      <div className="flex items-center gap-1.5">
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={() => setText(getJSON())}
          className="gap-1.5"
        >
          <RefreshCw className="h-3 w-3" />
          Refresh
        </Button>
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={onLoad}
          className="gap-1.5"
        >
          <Upload className="h-3 w-3" />
          Apply JSON
        </Button>
        <Button 
          size="sm" 
          onClick={save}
          className="gap-1.5 ml-auto"
        >
          <Save className="h-3 w-3" />
          Save (local)
        </Button>
      </div>

      {/* JSON Editor */}
      <Textarea 
        className={cn(
          "flex-1 min-h-[200px] font-mono text-xs",
          "bg-muted/30 border-muted",
          "focus:bg-background",
          "resize-none"
        )} 
        value={text} 
        onChange={(e) => setText(e.target.value)} 
        placeholder="Document JSON..."
      />

      {/* Documents List */}
      {documents.length > 0 && (
        <div className="border-t border-border pt-3 space-y-2">
          <div className="text-xs text-muted-foreground">
            Found {count} document{count !== 1 ? 's' : ''}
          </div>
          <div className="space-y-1 max-h-[200px] overflow-auto">
            {documents.map((d: any) => {
              const id = d._id || d.id || '';
              const title = d.title || '(untitled)';
              const isSelected = documentId === String(id);
              
              return (
                <button 
                  key={id} 
                  className={cn(
                    "w-full text-left text-sm p-2 rounded-md",
                    "border border-transparent",
                    "transition-colors cursor-pointer",
                    "hover:bg-accent/50",
                    isSelected && "bg-primary/10 border-primary/30"
                  )}
                  onClick={() => setDocumentId(String(id))}
                >
                  <div className="font-mono text-xs text-muted-foreground truncate">
                    {String(id)}
                  </div>
                  <div className="truncate">{String(title)}</div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
