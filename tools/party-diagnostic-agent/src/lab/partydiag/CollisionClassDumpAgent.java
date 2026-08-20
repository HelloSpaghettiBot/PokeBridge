package lab.partydiag;
import java.lang.instrument.*;import java.nio.file.*;import java.security.ProtectionDomain;import java.util.Set;
/** Dumps the movement-state collision coordinator. */
public final class CollisionClassDumpAgent{
  public static void agentmain(String options,Instrumentation instrumentation)throws Exception{Path root=Path.of(options);Files.createDirectories(root);Set<String> targets=Set.of("f.NV0","f.tr","f.a02");ClassFileTransformer transformer=new ClassFileTransformer(){@Override public byte[] transform(ClassLoader loader,String name,Class<?> type,ProtectionDomain domain,byte[] bytes){String dotted=name.replace('/','.');if(!targets.contains(dotted))return null;try{Files.write(root.resolve(dotted+".class"),bytes);}catch(Throwable ignored){}return null;}};instrumentation.addTransformer(transformer,true);try{for(Class<?> type:instrumentation.getAllLoadedClasses())if(targets.contains(type.getName())&&instrumentation.isModifiableClass(type))instrumentation.retransformClasses(type);}finally{instrumentation.removeTransformer(transformer);}}
}
