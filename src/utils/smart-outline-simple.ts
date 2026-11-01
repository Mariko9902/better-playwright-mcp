   
                       
   

import { ListDetector, type ListPattern } from './list-detector.js';
import { UselessWrapperRemover } from './remove-useless-wrappers.js';
import type { ElementNode } from '../types/outline.js';

export class SmartOutlineSimple {
  private listDetector = new ListDetector();
  private wrapperRemover = new UselessWrapperRemover();
  private readonly TEXT_TRUNCATE_LENGTH = 50;
  private readonly MAX_REFS_IN_SUMMARY = 5;
  
     
         
     
  generate(snapshot: string): string {
    const lines = snapshot.split('\n');
    let rootNodes = this.buildTree(lines);
    
                       
    rootNodes = this.wrapperRemover.removeWrappers(rootNodes);
    
                 
    const outlineLines = this.processWithListDetection(rootNodes);
    
    return `Page Outline (${outlineLines.length}/${lines.length} lines):\n` + outlineLines.join('\n');
  }
  
     
         
     
  private parseLine(line: string, lineNumber: number): ElementNode | null {
    const indent = line.length - line.trimStart().length;
    const elementMatch = line.match(/^\s*-\s*([a-z]+)(.*)$/);
    
    if (!elementMatch) return null;
    
    const type = elementMatch[1];
    const rest = elementMatch[2];
    
    const refMatch = rest.match(/\[ref=([^\]]+)\]/);
    const ref = refMatch ? refMatch[1] : '';
    
    let content = rest;
    if (refMatch)
      content = content.replace(refMatch[0], ' ');
    content = content
      .replace(/\[cursor=pointer\]/g, ' ')
      .replace(/^\s*:\s*/, '')
      .replace(/\s+:\s+/g, ': ')
      .replace(/\s+/g, ' ')
      .trim();
    
    const hasInteraction = line.includes('[cursor=pointer]');
    
    return {
      indent,
      type,
      ref,
      content,
      line,
      children: [],
      priority: 5,
      isRepetitive: false,
      lineNumber,
      hasInteraction
    };
  }
  
     
          
     
  private buildTree(lines: string[]): ElementNode[] {
    const rootNodes: ElementNode[] = [];
    const stack: ElementNode[] = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) continue;
      
      const node = this.parseLine(line, i);
      if (!node) continue;
      
      while (stack.length > 0 && stack[stack.length - 1].indent >= node.indent) {
        stack.pop();
      }
      
      if (stack.length > 0) {
        const parent = stack[stack.length - 1];
        parent.children.push(node);
        node.parent = parent;
      } else {
        rootNodes.push(node);
      }
      
      stack.push(node);
    }
    
    return rootNodes;
  }
  
     
                
     
  private processWithListDetection(nodes: ElementNode[]): string[] {
    const output: string[] = [];
    
                       
    if (nodes.length >= 3) {
      const lists = this.filterNonOverlappingLists(this.listDetector.detectLists(nodes));
      
      if (lists.length > 0) {
        const listsByStart = new Map<number, ListPattern>();
        for (const list of lists)
          listsByStart.set(list.start, list);

        for (let index = 0; index < nodes.length; index++) {
          const list = listsByStart.get(index);
          if (list) {
            output.push(...this.formatList(list));
            if (list.sample.children.length > 0)
              output.push(...this.processWithListDetection(list.sample.children));
            index = list.end;
            continue;
          }

          const node = nodes[index];
          output.push(this.formatNode(node));
          if (node.children.length > 0)
            output.push(...this.processWithListDetection(node.children));
        }
        
        return output;
      }
    }
    
                       
    for (const node of nodes) {
      output.push(this.formatNode(node));
      
                
      if (node.children.length > 0) {
        const childLines = this.processWithListDetection(
          node.children
        );
        output.push(...childLines);
      }
    }
    
    return output;
  }
  
     
          
     
  private formatList(list: ListPattern): string[] {
    const output: string[] = [];
    const indent = ' '.repeat(list.sample.indent);
    
             
    output.push(this.formatNode(list.sample));
    
            
    if (list.count > 1) {
      const remaining = list.count - 1;
      const refs = list.refs.slice(1, Math.min(this.MAX_REFS_IN_SUMMARY + 1, list.refs.length));
      
      let foldLine = `${indent}- ${list.sample.type}`;
      foldLine += ` (... and ${remaining} more similar)`;
      
      if (refs.length > 0) {
        foldLine += ` [refs: ${refs.join(', ')}`;
        if (list.refs.length > this.MAX_REFS_IN_SUMMARY + 1) {
          foldLine += ', ...';
        }
        foldLine += ']';
      }
      
      output.push(foldLine);
    }
    
    return output;
  }
  
     
          
     
  private formatNode(node: ElementNode): string {
    const indent = ' '.repeat(node.indent);
    let result = `${indent}- ${node.type}`;
    
            
    if (node.content) {
      let content = node.content;
      if (content.length > this.TEXT_TRUNCATE_LENGTH) {
        content = content.substring(0, this.TEXT_TRUNCATE_LENGTH) + '...';
      }
      result += ` ${content}`;
    }
    
            
    if (node.ref) {
      result += ` [ref=${node.ref}]`;
    }
    
             
    if (node.hasInteraction) {
      result += ' [cursor=pointer]';
    }
    
    return result;
  }

  private filterNonOverlappingLists(lists: ListPattern[]): ListPattern[] {
    const ordered = [...lists].sort((a, b) => {
      if (a.start !== b.start)
        return a.start - b.start;
      if (a.type !== b.type)
        return a.type === 'semantic' ? -1 : 1;
      return b.count - a.count;
    });

    const result: ListPattern[] = [];
    let lastEnd = -1;
    for (const list of ordered) {
      if (list.start <= lastEnd)
        continue;
      result.push(list);
      lastEnd = list.end;
    }
    return result;
  }
}
