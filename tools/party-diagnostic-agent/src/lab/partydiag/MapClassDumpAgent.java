package lab.partydiag;

import java.lang.instrument.ClassFileTransformer;
import java.lang.instrument.Instrumentation;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.ProtectionDomain;
import java.util.Set;

/** Dumps selected already-loaded navigation classes for local, read-only bytecode inspection. */
public final class MapClassDumpAgent {
  private MapClassDumpAgent() {}
  public static void agentmain(String options, Instrumentation instrumentation) throws Exception {
    Path root=Path.of(options);Files.createDirectories(root);
    Set<String> targets=Set.of("f.iM0","f.eP1","f.tM","f.Ro","f.tS1","f.ti","f.E41","f.Wi1","f.Qy0","f.Ro0");
    ClassFileTransformer transformer=new ClassFileTransformer(){
      @Override public byte[] transform(ClassLoader loader,String className,Class<?> type,ProtectionDomain domain,byte[] bytes){
        String name=className.replace('/','.');if(!targets.contains(name))return null;
        try{Files.write(root.resolve(name+".class"),bytes);}catch(Throwable ignored){}return null;
      }
    };
    instrumentation.addTransformer(transformer,true);
    try{for(Class<?> type:instrumentation.getAllLoadedClasses())if(targets.contains(type.getName())&&instrumentation.isModifiableClass(type))instrumentation.retransformClasses(type);}
    finally{instrumentation.removeTransformer(transformer);}
  }
}
