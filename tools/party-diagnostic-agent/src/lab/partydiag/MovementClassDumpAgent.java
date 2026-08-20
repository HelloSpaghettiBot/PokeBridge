package lab.partydiag;

import java.lang.instrument.ClassFileTransformer;
import java.lang.instrument.Instrumentation;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.ProtectionDomain;
import java.util.Set;

/** Dumps the loaded movement coordinator and concrete terrain behavior classes. */
public final class MovementClassDumpAgent {
  private MovementClassDumpAgent() {}
  public static void agentmain(String options, Instrumentation instrumentation)throws Exception{
    Path root=Path.of(options);Files.createDirectories(root);
    Set<String> targets=Set.of("f.ln1","f.HQ","f.id","f.wP","f.In","f.co","f.iZ1","f.xq1");
    ClassFileTransformer transformer=new ClassFileTransformer(){@Override public byte[] transform(ClassLoader loader,String name,Class<?> type,ProtectionDomain domain,byte[] bytes){String dotted=name.replace('/','.');if(!targets.contains(dotted))return null;try{Files.write(root.resolve(dotted+".class"),bytes);}catch(Throwable ignored){}return null;}};
    instrumentation.addTransformer(transformer,true);try{for(Class<?> type:instrumentation.getAllLoadedClasses())if(targets.contains(type.getName())&&instrumentation.isModifiableClass(type))instrumentation.retransformClasses(type);}finally{instrumentation.removeTransformer(transformer);}
  }
}
